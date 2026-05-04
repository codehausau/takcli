Output docs/assets/takcli-readme-live.gif

Set Shell "bash"
Set FontSize 18
Set Width 1200
Set Height 760
Set TypingSpeed 20ms

Hide
Type "export PS1='$'"
Enter
Type "clear"
Enter
Wait+Line /\$$/
Show

Type "takcli version"
Enter
Wait+Line /\$$/
Sleep 500ms

Type "takcli profile add live-demo --server https://takserver:8443 --api-port 8443 --cot-port 8089 --cert-file /tmp/takcli-live-demo/certs/admin.pem --key-file /tmp/takcli-live-demo/certs/admin.key --insecure --set-current"
Enter
Wait+Line /\$$/
Sleep 500ms

Type "takcli status"
Enter
Wait+Line /\$$/
Sleep 500ms

Type "takcli doctor"
Enter
Wait+Line /\$$/
Sleep 500ms

Type "takcli users list"
Enter
Wait+Line /\$$/
Sleep 500ms

Type "takcli users create readme-demo --password 'Str0ng!Password1' --group Blue"
Enter
Wait+Line /\$$/
Sleep 500ms

Type "takcli users groups members Blue"
Enter
Wait+Line /\$$/
Sleep 500ms

Type "takcli cot inject --uid readme-demo-1 --type a-f-G-U-C --lat -35.2809 --lon 149.13 --callsign README --remarks 'README live demo'"
Enter
Wait+Line /\$$/
Sleep 500ms

Type "takcli cot query --uid readme-demo-1 --timeout 5000"
Enter
Wait+Line /\$$/
Sleep 500ms

Type "takcli users delete readme-demo"
Enter
Wait+Line /\$$/
Sleep 800ms

Type "takcli deploy --target docker-compose --repo-url /tmp/takcli-demo-repo --dry-run --yes"
Enter
Sleep 700ms

Enter
Sleep 180ms

Type "demo"
Enter
Sleep 180ms

Type "/tmp/takcli-demo/workspace"
Enter
Sleep 180ms

Type "/tmp/takcli-demo/data"
Enter
Sleep 180ms

Type "/tmp/takcli-demo/data/logs"
Enter
Sleep 180ms

Type "/tmp/takcli-demo/data/certs"
Enter
Sleep 180ms

Enter
Sleep 180ms

Enter
Sleep 180ms

Enter
Sleep 180ms

Type "change-me"
Enter
Sleep 180ms

Type "demo-CA"
Enter
Sleep 180ms

Type "change-me"
Enter
Sleep 180ms

Type "Adelaide"
Enter
Sleep 180ms

Type "Codehaus"
Enter
Sleep 180ms

Type "Ops"
Enter
Sleep 180ms

Type "change-me"
Enter
Sleep 180ms

Type "SA"
Enter
Sleep 180ms

Type "change-me"
Enter
Sleep 1500ms
Wait+Line /\$$/

Type "exit"
Enter
