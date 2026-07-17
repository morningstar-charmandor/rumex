# Trying the honest sign-in window in the real app

This checks the new behaviour end-to-end **inside the actual product** (not the
standalone tester): when a Google app needs a login, a proper top-level window
opens showing the real Google address, you sign in there, it closes by itself,
and the app is signed in.

The best proof is to use a **Google Workspace / work account** — one of the ones
that *couldn't* sign in before. If that now works, the change did its job.

---

## 1. Get the latest code

Open Terminal and go to the project folder (the `rumex` folder — **not** the
`login-test` one this time):

```
cd "PATH-TO-THE-PROJECT/rumex"
git pull origin claude/firefox-disguise-usage-hqzqkp
```

> Tip: type `cd ` (with a space), drag the `rumex` folder from Finder onto the
> Terminal window, then press Enter.

## 2. Start the real app

```
npm install
npm run dev
```

- `npm install` only needs doing the first time (it may take a minute or two).
- `npm run dev` launches the actual app. Leave this Terminal window open while
  you test — the app runs from it.

## 3. Add a Gmail app using a WORK account

1. In the app, add a new Gmail app (use the address **`https://mail.google.com`**),
   or open an existing Gmail one that is **signed out**.
2. Because it's signed out, it will try to log in — **and this is the moment to
   watch.**

## 4. What you should see (the whole point)

- A **separate window pops up** with a strip along the top showing a **lock** and
  the real address **`accounts.google.com`**. That's the honest sign-in window.
- Sign in there like normal (email → password → any verification).
- When you finish, that window **closes by itself**, and your Gmail panel in the
  app **loads already signed in.**

✅ **Success = the work/Workspace account that failed before now signs in**, and
you land in the inbox inside the app.

## 5. Worth a couple of rounds

- Try it with a **work account** (the important case), and also a personal
  `@gmail.com` account.
- To retest from scratch, remove the Gmail app and add it again (a freshly added
  app starts signed out).

## 6. If something looks off

Tell me what you saw, as specifically as you can — for example:

- The pop-up window **didn't appear**, and the login happened in the panel instead.
- The pop-up appeared but **didn't close** after you signed in.
- It signed in, but the Gmail panel **didn't load** the inbox afterwards.
- Any error message, and **which account type** (work vs personal) it happened on.

A screenshot of the moment it goes wrong is perfect. From there I can adjust.

## When you're done

Close the app window, then click the Terminal and press **Control + C** to stop it.
