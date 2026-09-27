# After Effects Launch Policy

EditFlow's default After Effects launch target on this workstation is:

`C:\Users\Shadow\Downloads\Open Template.aep`

Rules:

1. A cold start or restart must open After Effects by opening this project file.
2. Do not launch a naked After Effects application window as the first recovery action.
3. Reuse one healthy existing After Effects process when one is already running.
4. CEP `-r` bootstrap commands are warm-host follow-up actions; they are not the cold-start path.
5. Practice uses the same launch policy before panel/bootstrap recovery.
6. The persistent workstation policy lives at `%LOCALAPPDATA%\EditFlow2\ae-launch-policy.json`.
7. The canonical launcher is `%LOCALAPPDATA%\EditFlow2\open-after-effects-template.ps1`.
8. `EDITFLOW_AE_DEFAULT_PROJECT` may override the path explicitly, but its default is Open Template.

This is the first AE-opening route ChatGPT/EditFlow should attempt in every workflow.
