-- Accessibility Checklist Scanner Launcher
-- Answers a11y-checklist:// links from the start page (index.html). Only two
-- things can happen, whatever the link says: "stop" stops the scanner; anything
-- else starts it (or opens it if it is already running). The scanner runs in
-- the background, so no Terminal window and none of its permission dialogs.
property scannerFolder : "__FOLDER__"

on run
	startScanner()
end run

on open location theURL
	if theURL contains "stop" then
		stopScanner()
	else
		startScanner()
	end if
end open location

on isUp()
	try
		do shell script "curl -s -o /dev/null -m 1 http://127.0.0.1:4173/ping"
		return true
	on error
		return false
	end try
end isUp

on startScanner()
	if isUp() then
		do shell script "open http://127.0.0.1:4173/"
	else
		set q to quoted form of scannerFolder
		-- The downloaded copy brings its own Node.js in runtime/; a copy from source uses the machine's.
		do shell script "cd " & q & " && if [ -x runtime/bin/node ]; then N=./runtime/bin/node; else N=$(command -v node || echo /usr/local/bin/node); fi; nohup \"$N\" bin/a11y.js ui > /tmp/a11y-checklist-scanner.log 2>&1 &"
	end if
end startScanner

on stopScanner()
	try
		do shell script "pkill -f 'bin/a11y.js ui$' ; pkill -f 'bin/a11y.js ui --no-open$'; true"
	end try
end stopScanner
