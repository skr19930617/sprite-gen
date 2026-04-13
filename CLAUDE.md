<!-- specflow:managed:start -->
## Contract Discipline

- Prefer explicit, enforceable contracts over implicit behavior.
- Strengthen contracts instead of relying on hidden assumptions or hardcoded logic.
- Avoid hardcoding behavior that should be defined by contracts, schemas, configuration, or shared generators.
- Do not add special-case behavior unless it is explicitly part of the contract.
- If a contract changes, update the corresponding tests in the same change.
- Contract validation is required, not optional.
- After making changes, run the repository's defined verification steps for the affected scope.
- This includes formatting, linting, type checking, tests, and build steps whenever the repository defines them and they are relevant to the change.
- Do not consider a change complete until the relevant verification steps pass.
- Prefer repository-defined commands and workflows over ad hoc validation.
<!-- specflow:managed:end -->

## MANUAL ADDITIONS

<!-- Add project-specific guidance here. Content outside the managed block is preserved by specflow. -->
