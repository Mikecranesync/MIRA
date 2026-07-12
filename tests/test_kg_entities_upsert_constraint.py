"""Test kg_entities upsert with ON CONFLICT ON CONSTRAINT.

This test verifies that the fix for issue #2564 works: the ON CONFLICT clause
now targets the named constraint kg_entities_tenant_type_name_uq instead of
inferring from column names, which was failing in prod with "no unique or
exclusion constraint matching the ON CONFLICT specification".
"""

import pytest
import subprocess
import os
from uuid import uuid4


@pytest.mark.integration
def test_kg_entities_upsert_on_conflict_constraint():
    """Test that kg_entities upsert works with ON CONFLICT ON CONSTRAINT.

    This is an integration test that:
    1. Spins up a temporary PostgreSQL container
    2. Applies migrations 001, 025, 026, 064
    3. Tests the INSERT ... ON CONFLICT ON CONSTRAINT kg_entities_tenant_type_name_uq
    4. Verifies idempotency (re-inserting with same key returns same id)
    """

    # Skip if DOCKER_HOST is not set (no Colima/Docker available)
    if not os.getenv("DOCKER_HOST"):
        pytest.skip("DOCKER_HOST not set — skipping container test")

    docker_socket = os.getenv("DOCKER_HOST", "unix:///Users/charlienode/.colima/default/docker.sock")

    # Start a temporary postgres container
    container_name = f"pg-test-kg-upsert-{uuid4()}"
    try:
        # Start postgres:16 container
        subprocess.run(
            [
                "docker", "run", "-d",
                "--name", container_name,
                "-e", "POSTGRES_HOST_AUTH_METHOD=trust",
                "-p", "5433:5432",  # Use a non-standard port
                "postgres:16",
            ],
            check=True,
            capture_output=True,
            timeout=30,
            env={**os.environ, "DOCKER_HOST": docker_socket},
        )

        # Wait for postgres to be ready
        import time
        max_attempts = 30
        for attempt in range(max_attempts):
            try:
                subprocess.run(
                    ["psql", "-h", "localhost", "-p", "5433", "-U", "postgres", "-c", "SELECT 1"],
                    check=True,
                    capture_output=True,
                    timeout=5,
                    env={**os.environ, "PGPASSWORD": ""},
                )
                break
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
                if attempt < max_attempts - 1:
                    time.sleep(1)
                else:
                    raise

        # Apply migrations: 001_knowledge_graph, 025, 026, 064
        migration_files = [
            "mira-hub/db/migrations/001_knowledge_graph.sql",
            "mira-hub/db/migrations/025_kg_entities_natural_key.sql",
            "mira-hub/db/migrations/026_kg_entities_dedupe_and_constraint.sql",
            "mira-hub/db/migrations/064_kg_entities_upsert_constraint.sql",
        ]

        for mig_file in migration_files:
            if not os.path.exists(mig_file):
                pytest.skip(f"Migration file {mig_file} not found")

            with open(mig_file, "r") as f:
                sql = f.read()

            # Apply the migration
            result = subprocess.run(
                ["psql", "-h", "localhost", "-p", "5433", "-U", "postgres", "-d", "postgres"],
                input=sql.encode(),
                check=True,
                capture_output=True,
                timeout=10,
                env={**os.environ, "PGPASSWORD": ""},
            )

        # Now test the actual upsert
        tenant_id = str(uuid4())
        entity_type = "equipment"
        name = "test_model"
        uns_path = "enterprise.test.model"

        # First insert
        insert_sql = f"""
        INSERT INTO kg_entities
            (tenant_id, entity_type, name, properties, uns_path)
        VALUES
            ('{tenant_id}'::uuid, '{entity_type}', '{name}', '{{}}'::jsonb, '{uns_path}'::ltree)
        ON CONFLICT ON CONSTRAINT kg_entities_tenant_type_name_uq DO UPDATE
            SET properties = COALESCE(kg_entities.properties, '{{}}'::jsonb) || EXCLUDED.properties
        RETURNING id;
        """

        result = subprocess.run(
            ["psql", "-h", "localhost", "-p", "5433", "-U", "postgres", "-d", "postgres", "-t", "-c", insert_sql],
            check=True,
            capture_output=True,
            timeout=5,
            env={**os.environ, "PGPASSWORD": ""},
        )

        first_id = result.stdout.decode().strip()
        assert first_id, "First insert should return an id"

        # Second insert with same key (should be idempotent)
        result = subprocess.run(
            ["psql", "-h", "localhost", "-p", "5433", "-U", "postgres", "-d", "postgres", "-t", "-c", insert_sql],
            check=True,
            capture_output=True,
            timeout=5,
            env={**os.environ, "PGPASSWORD": ""},
        )

        second_id = result.stdout.decode().strip()
        assert second_id == first_id, "Second insert with same key should return same id"

        # Verify the row exists
        verify_sql = f"SELECT COUNT(*) FROM kg_entities WHERE tenant_id='{tenant_id}'::uuid AND entity_type='{entity_type}' AND name='{name}';"
        result = subprocess.run(
            ["psql", "-h", "localhost", "-p", "5433", "-U", "postgres", "-d", "postgres", "-t", "-c", verify_sql],
            check=True,
            capture_output=True,
            timeout=5,
            env={**os.environ, "PGPASSWORD": ""},
        )

        count = int(result.stdout.decode().strip())
        assert count == 1, f"Should have exactly 1 row, found {count}"

    finally:
        # Clean up container
        subprocess.run(
            ["docker", "rm", "-f", container_name],
            capture_output=True,
            timeout=10,
            env={**os.environ, "DOCKER_HOST": docker_socket},
        )


@pytest.mark.unit
def test_kg_entities_constraint_exists_after_migration():
    """Verify that migration 064 creates the named constraint."""

    # This test verifies the migration SQL is syntactically correct
    # by parsing it. Since we can't run it without a real DB, we at least
    # check the DDL is present.

    with open("mira-hub/db/migrations/064_kg_entities_upsert_constraint.sql", "r") as f:
        sql = f.read()

    # Check the expected statements are present
    assert "ADD CONSTRAINT kg_entities_tenant_type_name_uq" in sql, "Migration should add the constraint"
    assert "UNIQUE USING INDEX kg_entities_tenant_type_name_key" in sql, "Migration should use the existing index"
    assert "BEGIN;" in sql and "COMMIT;" in sql, "Migration should be wrapped in a transaction"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
