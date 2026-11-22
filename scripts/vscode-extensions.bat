@echo off
rem Installs every VS Code extension this project recommends (same list as .vscode\extensions.json).
where code >nul 2>nul || (echo The "code" command was not found. Install VS Code first: https://code.visualstudio.com & exit /b 1)
for %%e in (hashicorp.terraform redhat.ansible redhat.vscode-yaml amazonwebservices.aws-toolkit-vscode janjoerke.jenkins-pipeline-linter-connector timonwong.shellcheck editorconfig.editorconfig esbenp.prettier-vscode eamodio.gitlens yzhang.markdown-all-in-one bierner.markdown-mermaid) do (
  echo Installing %%e
  call code --install-extension %%e --force >nul
)
echo Done. Restart VS Code.
