"""Entity extractors for the KG flywheel.

Each extractor turns chunk text / metadata into KG entity + relationship
upsert calls. They are pure functions over a (chunk, manufacturer, model)
tuple — no side effects until the caller invokes the kg_writer module.
"""
