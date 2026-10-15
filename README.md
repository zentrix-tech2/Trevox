# Trevox — Referral Rewards Website

A responsive Trevox-branded website built with Node.js, Express and SQLite. It uses the supplied Trevox image as the visual background.

## Features
- Member registration and login
- $0.50 welcome bonus on registration
- Referral links and $0.10 reward for each tracked referral
- USDT BEP20 withdrawal requests with a $3 minimum
- 10% fee calculation shown before admin review
- Admin login and dashboard for approving/rejecting withdrawals
- Basic shared-IP risk signals and event log
- Responsive desktop and mobile styling

## Run locally
1. Install Node.js 20 or newer on your computer.
2. Extract this ZIP.
3. Copy `.env.example` to `.env`.
4. Change `SESSION_SECRET` to a long random string and change `ADMIN_PASSWORD` to a strong password.
5. Open a terminal in the extracted `trevox` folder and run:
   ```bash
   npm install
   npm start
   ```
6. Visit `http://localhost:3000`. Admin page: `http://localhost:3000/admin/login`.

## Host online (Railway)
1. Create an account at https://railway.com.
2. Put this project in a GitHub repository (include `package.json`, `server.js`, `public/`, `.env.example`, and `.gitignore`; do not upload your real `.env`).
3. In Railway, create a new project and deploy from that GitHub repository.
4. Add these variables in the service's Variables section:
   - `NODE_ENV=production`
   - `SESSION_SECRET` = a long random secret
   - `ADMIN_USERNAME` = your preferred admin username
   - `ADMIN_PASSWORD` = a strong unique admin password
   - `SITE_URL` = your deployed HTTPS domain
   - `WELCOME_BONUS=0.50`
   - `REFERRAL_REWARD=0.10`
   - `MIN_WITHDRAWAL=3.00`
   - `WITHDRAWAL_FEE_RATE=0.10`
5. Ensure the SQLite database file `trevox.db` is stored on a persistent volume mounted to the project directory. Without persistent storage, user accounts and balances may be lost during redeploys/restarts.
6. Generate a public domain in Railway, then open the HTTPS URL and test registration, referral links, withdrawals and the admin dashboard.

## Important limitations before public launch
This is a starter implementation, not a production security audit or payment processor. It does not automatically send USDT. Admin approval records a decision only; any payout must be sent separately and reconciled. Add rate limiting, CSRF protection, email verification, password reset, a privacy policy, backups and security review before inviting the public. Set up persistent storage before real users register.

IP matching is only a risk signal, not proof of abuse. Households, workplaces and mobile carrier networks can share IP addresses. Review cases manually rather than automatically treating every shared IP as fraud.

The website does not ask for seed phrases, private keys or deposits.
