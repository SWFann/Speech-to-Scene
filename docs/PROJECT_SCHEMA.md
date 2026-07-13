# Project Schema

Status: draft; the executable Zod schema will be implemented and frozen during M1.

The persisted project filename is `project.s2s.json`. The schema must remain independent from the CLI, web UI, LLM SDKs, asset-provider SDKs, and filesystem implementation.

M1 must define and test:

- project metadata and schema version;
- source document hash and relative path;
- deterministic scene anchors and resolved source ranges;
- visual decisions and search queries;
- normalized asset candidates;
- asset rights, attribution, provider terms, and retrieval snapshots;
- user review decisions and local asset records;
- derived project and scene status;
- unknown-version rejection and atomic persistence.

Before the first public `0.1` release, refer to `PROJECT_ANALYSIS_AND_RECOMMENDATIONS.md` for the required Provider and `AssetRights` changes to the original plan.
