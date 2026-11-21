# Repeat Mailer

A small, local web application for scheduling recurring plain-text emails through Gmail. Create one-recipient schedules that repeat at a custom interval in minutes (including every 1 minute). Pause, resume, or cancel a schedule from the dashboard.

## Requirements

- Node.js 20 or newer
- A Gmail account with 2-Step Verification enabled
- A Google App Password for that Gmail account

## Setup on Windows

1. Extract this folder somewhere convenient.
2. Install Node.js 20+ if it is not already installed: https://nodejs.org/
3. In this folder, copy `.env.example` to a new file named `.env`.
4. Create a Google App Password for `pandeynikhilone@gmail.com`:
   - Open your Google Account security settings: https://myaccount.google.com/security
   - Enable 2-Step Verification if it is not enabled.
   - Open App passwords: https://myaccount.google.com/apppasswords
   - Create an app password and copy the generated password.
   - Paste it into `.env` as `GMAIL_APP_PASSWORD=...` (spaces may be omitted).
5. Keep `GMAIL_USER=pandeynikhilone@gmail.com` in `.env` unless you are intentionally connecting a different Gmail account.
6. Open Command Prompt or PowerShell in this folder and run:

   ```powershell
   npm install
   npm start
   ```

7. Open http://127.0.0.1:3030 in your browser.

The first-send time defaults to 9:00 AM tomorrow in your computer's local time. Change it before creating the schedule if needed.

## Important operating notes

- **Keep the app running.** This local app sends scheduled emails only while its Node.js process is running and the computer is awake and connected to the internet. Closing the terminal, shutting down, or sleeping the computer pauses the scheduler. When it starts again, it processes an overdue occurrence once and resumes the cadence from that attempt; it does not send a backlog of missed emails.
- **Sender identity is enforced.** The sender field defaults to `pandeynikhilone@gmail.com`, but Gmail will only send from the account authenticated in `.env`. The app rejects a different sender address; it cannot spoof another mailbox.
- **Repeat interval.** Enter a whole-number interval from 1 to 525,600 minutes. Set it to `1` to send every minute. There is one recipient per schedule, no bulk recipient list, and a maximum of 20 active/paused schedules. Sending every minute can quickly reach Gmail sending limits and may cause Gmail to throttle or block delivery; only use recurring messages with the recipient’s consent.
- **Cancel vs. pause.** Pause stops future scheduled attempts but can be resumed. Cancel is permanent for that schedule. An email already being handed to Gmail at the moment you cancel may still complete.
- **Failures.** A failed attempt is shown on the schedule card. The schedule remains active and the next attempt is set for its next normal interval. Check the displayed error and your Gmail account if a send fails.
- **Local-only security.** The server binds to `127.0.0.1` by default. Do not change `HOST` to `0.0.0.0` or expose this app to the public internet without adding proper authentication, HTTPS, and deployment hardening.
- **Data storage.** Schedule details are saved in `data/schedules.json` on this computer. Your Gmail App Password is stored only in `.env`. Do not share either file.

## Stop the app

Press `Ctrl + C` in the terminal running `npm start`. This stops scheduled sending until you start it again.
