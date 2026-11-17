# Home Budget Planner on Netlify

This folder is a ready-to-deploy Netlify site.

- `public/index.html` is the app.
- `netlify/functions/api.mjs` handles sign-in and stores everyone's entries online. It uses Netlify Blobs, the free storage built into Netlify.
- Each family member gets their own username and password. Every entry records who added it.

The first time the app opens, it adds your two entries from the spreadsheet automatically.

## Option A: Deploy from GitHub (recommended)

1. Create a new GitHub repository. Upload everything in this folder to it: `public/`, `netlify/`, `netlify.toml` and `package.json`.
2. In Netlify, go to **Add new site → Import an existing project** and pick that repository. Leave the build settings as they are, because `netlify.toml` already sets them.
3. Go to **Site configuration → Environment variables**. Add `BUDGET_PASSCODE` and set it to a passcode only you know.
4. Go to **Deploys → Trigger deploy → Deploy site** so the setting takes effect.
5. Open the site URL. The first screen asks you to create the admin account: your name, a username, a password, and the passcode from step 3. After that, open the **Family** tab to add everyone else.

## Option B: Deploy from your computer with the Netlify CLI

You need Node.js 18 or newer.

```
npm install -g netlify-cli
cd budget-netlify
npm install
netlify login
netlify init        # creates the site
netlify env:set BUDGET_PASSCODE "your-passcode"
netlify deploy --prod
```

Netlify Drop (drag and drop) won't work for this site. Drop publishes only static files and skips the sign-in and storage function.

## Family accounts

- `BUDGET_PASSCODE` is used only once, to create the first account, which belongs to the head of household. It stops a stranger who finds the site from setting it up first. After that, everyone signs in with their own username and password.
- The **head of household** can:
  - see every family member's records. On the Family tab, **View records** next to a person lists everything they entered.
  - edit or delete any entry
  - add family members, reset passwords and remove people
  - change budgets, categories and the exchange rate
  - make another person head of household too, for example a second parent
- **Family members** see only their own entries, enforced on the server, not just hidden on screen. They can add entries, and can edit or delete only the entries they added.
- Every entry shows "by Name". If someone else edits it, it also shows "edited by Name". The Overview has an **Entered by** card, and the Transactions tab has a filter for each person.
- **Forgot password?** on the sign-in screen offers two ways back in:
  - A member enters their username to ask for a reset. The head of household sees the request on the Family tab, shown as **Family (1)**, set a new password there, and tell the member.
  - Anyone who knows `BUDGET_PASSCODE`, which normally means the head of household, can choose a new password for any account, their own included, without signing in. This is how a head of household who forgot their own password gets back in.
- Removing someone signs them out right away. Their past entries keep their name.
- Each device stays signed in for 60 days. Changing a password signs that person out on their other devices.
- Everyone sees the same data. An entry added on one phone shows up on the others within a minute, or as soon as the app is reopened.

## Good to know

- **Export CSV** on the Transactions tab downloads a backup you can open in Excel or Google Sheets.
- The Claude version and the Netlify version keep separate data. Pick one to use day to day.
