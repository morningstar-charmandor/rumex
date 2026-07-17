# The two-way Google login test — how to run it

This little test answers one question in plain sight:

> **Does Google let us in when we're honest about who we are, or do we still
> need the Firefox "costume"?**

When you run it, **two windows open side by side**, both showing Google's
sign-in page:

- **Left window — "HONEST ID"** — we tell Google we're a normal Chrome browser.
- **Right window — "COSTUME (Firefox)"** — we tell Google we're Firefox (the
  disguise the product uses today).

You sign in with a real Google account in **both** windows and watch each
window's **title bar** (the strip along the top of each window). It updates
itself to tell you, in plain words, what Google did.

---

## Do this once: install the tool that runs it

You need a free program called **Node.js** (it's what runs this kind of app).

1. Go to **https://nodejs.org** and install the version it recommends
   ("LTS"). Click through the installer like any normal app.
2. That's the only setup. You won't need to touch it again.

> Not sure if you already have it? That's fine — installing again does no harm.

---

## Every time you want to run the test

1. Open your computer's **Terminal**:
   - **Mac:** press `Cmd + Space`, type `Terminal`, press Enter.
   - **Windows:** press the Start button, type `PowerShell`, press Enter.
2. Copy–paste these two lines, one at a time, pressing Enter after each. Replace
   `PATH-TO-THE-PROJECT` with wherever this project folder lives on your
   computer (you can drag the folder onto the Terminal window to fill in the
   path automatically):

   ```
   cd "PATH-TO-THE-PROJECT/login-test"
   npm install
   ```

   The first line moves into the test folder. The second downloads what it
   needs — **do this only the first time**; it may take a minute.

3. Then, to launch the test (this is the line you'll use each time):

   ```
   npm start
   ```

The two windows will pop open.

---

## What to do in the windows

1. In **each** window, sign in with a real Google account, exactly like you
   normally would (type the email, click Next, type the password, etc.).
2. Watch the **title bar** of each window as you go. It will say one of:

   | Title says… | Meaning |
   |---|---|
   | ✓ **proceeding normally** | Google is letting this one through — good sign |
   | ✓ **FULLY SIGNED IN** | Google let it all the way in |
   | ✗ **BLOCKED by Google** | This is the wall we're testing — Google refused |
   | ⚠ **suspicious of this NETWORK** | Not about the disguise — your internet looks odd to Google (try again on home wifi) |

---

## How to read the result

- **HONEST window gets in (✓) too, just like the COSTUME window** → great news:
  we may be able to **drop the disguise**. Your "honest login window" idea has
  real teeth.
- **HONEST window gets BLOCKED (✗) but the COSTUME window gets in (✓)** → the
  disguise is still doing real work and **needs to stay**. The nice login window
  is then worth doing purely to make users feel safe, not to avoid the costume.
- **Either window shows ⚠ (network)** → ignore that run and try again on a
  normal home internet connection; that warning isn't about the disguise.

Run it a couple of times to be sure the result is consistent.

When you're done, just close the windows.
