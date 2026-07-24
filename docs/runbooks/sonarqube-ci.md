# SonarQube CI

MIRA has an optional SonarQube GitHub Actions workflow at
`.github/workflows/sonarqube.yml`.

## Required GitHub configuration

Set these in repository settings before making the SonarQube check required:

- Secret: `SONAR_TOKEN`
- Variable: `SONAR_HOST_URL`
- Variable: `SONAR_PROJECT_KEY`

For SonarQube Cloud, also set:

- Variable: `SONAR_ORGANIZATION`

`SONAR_HOST_URL` is required on purpose. MIRA does not default to SonarQube
Cloud; using `https://sonarcloud.io` should be an explicit operator choice.

## Behavior

- Pull requests to `main`, pushes to `main`, and manual dispatches run the
  workflow.
- If the Sonar configuration is missing, the workflow exits successfully with a
  GitHub Step Summary explaining what is missing.
- Once configured, the workflow uses `SonarSource/sonarqube-scan-action@v8.2.1`
  with the checked-in `sonar-project.properties` scope.
- `sonar.qualitygate.wait=true` makes the CI job wait for the quality gate and
  fail when the configured gate fails.

## Scope

The checked-in `sonar-project.properties` focuses on first-party Python and
TypeScript/JavaScript modules. It excludes docs, wiki content, generated build
output, runtime artifacts, fixtures, examples, and migrations so the signal is
code quality rather than repository archaeology.
