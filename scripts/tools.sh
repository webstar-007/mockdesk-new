#!/usr/bin/env bash
# TOOLS: check that every tool the one click needs is installed, and install the missing ones if you say yes.
#
#   ./scripts/tools.sh             only check (changes nothing)
#   ./scripts/tools.sh --install   check, then ask "install it? [y/N]" for each missing tool
#   ./scripts/tools.sh --yes       check, then install every missing tool without asking
#
# Works on Ubuntu / Debian (apt) and macOS (Homebrew). On Windows use WSL with Ubuntu.
# Installing needs sudo; it will ask for your password.

MODE="check"
case "${1:-}" in
  --install|-i) MODE="ask" ;;
  --yes|-y)     MODE="yes" ;;
  ""|--check)   MODE="check" ;;
  -h|--help)    sed -n 2,10p "$0"; exit 0 ;;
  *)            echo "Unknown option $1. Use --install, --yes or no option."; exit 2 ;;
esac

MISSING=(); OPTIONAL_MISSING=(); FAIL=0
ok()   { printf '  [ OK ]  %s\n' "$1"; }
bad()  { printf '  [FAIL]  %s\n' "$1"; }
note() { printf '  [ -- ]  %s\n' "$1"; }
has()  { command -v "$1" >/dev/null 2>&1; }

OS="other"
if [ "$(uname -s)" = "Darwin" ]; then OS="mac"
elif has apt-get; then OS="apt"; fi

SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
CODENAME=""; [ "$OS" = "apt" ] && CODENAME="$(. /etc/os-release 2>/dev/null; echo "${VERSION_CODENAME:-}")"

# ---------------------------------------------------------------- how to install each tool
apt_update_once() { [ -n "${APT_UPDATED:-}" ] || { $SUDO apt-get update -y && APT_UPDATED=1; }; }
apt_get() { apt_update_once; $SUDO apt-get install -y "$@"; }

install_basics() {
  case $OS in apt) apt_get git curl tar unzip openssh-client ca-certificates gnupg ;; mac) brew install git curl ;; esac
}
install_terraform() {
  case $OS in
    apt) apt_get gnupg curl ca-certificates
         curl -fsSL https://apt.releases.hashicorp.com/gpg | $SUDO gpg --dearmor --yes -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
         echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $CODENAME main" | $SUDO tee /etc/apt/sources.list.d/hashicorp.list >/dev/null
         APT_UPDATED=""; apt_get terraform ;;
    mac) brew tap hashicorp/tap && brew install hashicorp/tap/terraform ;;
  esac
}
install_ansible() {
  case $OS in apt) apt_get ansible ;; mac) brew install ansible ;; esac
}
install_aws() {
  case $OS in
    apt) apt_get unzip curl
         local tmp; tmp="$(mktemp -d)"; cd "$tmp"; curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip" -o awscliv2.zip; unzip -q awscliv2.zip; $SUDO ./aws/install --update; cd /; rm -rf "$tmp" ;;
    mac) brew install awscli ;;
  esac
}
install_java() {
  case $OS in apt) apt_get openjdk-17-jre-headless ;; mac) brew install openjdk@17 ;; esac
}
install_jenkins() {
  case $OS in
    apt) has java || install_java
         $SUDO mkdir -p /etc/apt/keyrings
         $SUDO curl -fsSL https://pkg.jenkins.io/debian-stable/jenkins.io-2023.key -o /etc/apt/keyrings/jenkins-keyring.asc
         echo "deb [signed-by=/etc/apt/keyrings/jenkins-keyring.asc] https://pkg.jenkins.io/debian-stable binary/" | $SUDO tee /etc/apt/sources.list.d/jenkins.list >/dev/null
         APT_UPDATED=""; apt_get jenkins
         $SUDO systemctl enable --now jenkins
         echo "  Jenkins is starting on http://localhost:8080 . First-time password: sudo cat /var/lib/jenkins/secrets/initialAdminPassword"
         true ;;
    mac) brew install jenkins-lts && brew services start jenkins-lts ;;
  esac
}
install_node() {
  case $OS in
    apt) curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash - && apt_get nodejs ;;
    mac) brew install node@22 ;;
  esac
}

# ---------------------------------------------------------------- the list
# name | command | needed for | installer function | required (1) or optional (0)
LIST=(
  "git|git|put the project on GitHub|install_basics|1"
  "curl|curl|download and health checks|install_basics|1"
  "tar|tar|pack the app for the server|install_basics|1"
  "ssh|ssh|Ansible talks to the server over SSH|install_basics|1"
  "Terraform|terraform|build the server on AWS|install_terraform|1"
  "Ansible|ansible-playbook|set up the server and release the app|install_ansible|1"
  "AWS CLI|aws|log in to AWS and run the checks|install_aws|1"
  "Java|java|Jenkins runs on Java 17 or 21|install_java|1"
  "Jenkins|jenkins|the one click button|install_jenkins|1"
  "Node.js 22|node|run MockDesk on your laptop (optional)|install_node|0"
)

echo "Operating system: $( [ "$OS" = apt ] && echo "Debian/Ubuntu ($CODENAME)" || { [ "$OS" = mac ] && echo macOS || echo "not supported by the installer (checking only)"; } )"
echo
echo "1. Tools"
for row in "${LIST[@]}"; do
  IFS='|' read -r name cmd why fn req <<<"$row"
  found=0
  if [ "$cmd" = "jenkins" ]; then { has jenkins || [ -d /var/lib/jenkins ] || { [ "$OS" = mac ] && brew list jenkins-lts >/dev/null 2>&1; }; } && found=1
  else has "$cmd" && found=1; fi
  if [ $found -eq 1 ]; then
    case $cmd in
      terraform) v="$(terraform version 2>/dev/null | head -1)" ;;
      ansible-playbook) v="$(ansible --version 2>/dev/null | head -1)" ;;
      aws) v="$(aws --version 2>&1 | cut -d' ' -f1)" ;;
      java) v="$(java -version 2>&1 | grep -m1 ' version ' | sed 's/^.*version/Java/' | tr -d '"')" ;;
      ssh) v="$(ssh -V 2>&1 | head -1 | cut -d, -f1)" ;;
      node) v="node $(node -v 2>/dev/null)" ;;
      jenkins) v="installed" ;;
      *) v="$($cmd --version 2>&1 | head -1 | cut -c1-40)" ;;
    esac
    ok "$name: $v"
    if [ "$cmd" = "node" ] && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)" -lt 22 ] 2>/dev/null; then note "Node.js older than 22: MockDesk needs 22 on your laptop (the server gets 22 automatically)"; OPTIONAL_MISSING+=("$row"); fi
  elif [ "$req" = "1" ]; then bad "$name is missing ($why)"; MISSING+=("$row"); FAIL=$((FAIL+1))
  else note "$name is not installed ($why)"; OPTIONAL_MISSING+=("$row"); fi
done

echo
echo "2. Jenkins can use the tools"
if [ -d /var/lib/jenkins ] && has sudo; then
  for c in terraform ansible-playbook aws ssh curl tar; do
    if $SUDO -u jenkins bash -c "command -v $c" >/dev/null 2>&1; then ok "the jenkins user can run $c"; else bad "the jenkins user cannot find $c (install it system-wide, then restart Jenkins)"; FAIL=$((FAIL+1)); fi
  done
else
  note "Jenkins is not installed on this machine, skipping"
fi

echo
echo "3. Editor (optional)"
if has code; then ok "VS Code: found. Install the helpful extensions with ./scripts/vscode-extensions.sh"; else note "VS Code is not installed (https://code.visualstudio.com). Any editor works."; fi

# ---------------------------------------------------------------- install
run_install() {
  local row="$1"; IFS='|' read -r name cmd why fn req <<<"$row"
  echo; echo ">>> Installing $name ..."
  if [ "$OS" = "other" ]; then echo "    Automatic install is not supported on this system. Install $name by hand."; return 1; fi
  if [ "$OS" = "mac" ] && ! has brew; then echo "    Homebrew is needed first: https://brew.sh"; return 1; fi
  "$fn"
  hash -r   # forget remembered paths so the new tool is found
  local found=0
  if [ "$cmd" = "jenkins" ]; then { has jenkins || [ -d /var/lib/jenkins ] || { [ "$OS" = mac ] && brew list jenkins-lts >/dev/null 2>&1; }; } && found=1; else has "$cmd" && found=1; fi
  # success means: the tool can be found now (the install commands themselves may print harmless warnings)
  if [ $found -eq 1 ]; then echo "    $name done."; else echo "    $name FAILED. Read the messages above."; return 1; fi
}
if [ "$MODE" != "check" ] && { [ ${#MISSING[@]} -gt 0 ] || [ ${#OPTIONAL_MISSING[@]} -gt 0 ]; }; then
  echo
  DONE_FN=" "
  for row in "${MISSING[@]}" "${OPTIONAL_MISSING[@]}"; do
    [ -z "$row" ] && continue
    IFS='|' read -r name cmd why fn req <<<"$row"
    case "$DONE_FN" in *" $fn "*) continue ;; esac     # git, curl, tar, ssh share one installer
    go=0
    if [ "$MODE" = "yes" ]; then [ "$req" = "1" ] && go=1
    else read -r -p "Install $name now? [y/N] " a </dev/tty; case "$a" in y|Y|yes|YES) go=1 ;; esac; fi
    if [ $go -eq 1 ]; then run_install "$row" && DONE_FN="$DONE_FN$fn "; fi
  done
  echo; echo "Checking again..."; echo
  exec "$0"
fi

echo
if [ $FAIL -eq 0 ]; then echo "RESULT: ALL REQUIRED TOOLS ARE READY"; echo "Next: ./scripts/check-ready.sh (checks AWS and Jenkins), then follow docs/02-SETUP-GUIDE.md"; exit 0; fi
echo "RESULT: $FAIL THING(S) MISSING"
[ "$MODE" = "check" ] && echo "Run ./scripts/tools.sh --install to install them (it asks before each one)."
exit 1
