# ShopLedger: owner's runbook

For the owner only. Sign in with an owner PIN. The home screen has two extra tiles for you: **Settings** and **Add from a Spreadsheet**, and the **Who Did What** history.

## First day

1. Install ShopLedger on the shop PC (run `ShopLedger-Setup-<version>.exe` as an administrator). It opens by itself whenever Windows starts.
2. On the welcome screen, enter the shop name, address, state, GST number, and your name with a 4 to 6 digit PIN.
3. In **Settings > People**, add each staff member with their own PIN. Staff can bill and see daily reports. Only owners see profit, change settings and close days.
4. In **Settings > Printing**, choose A4 or the 80 mm roll and type the printer name exactly as Windows shows it. Leave it empty to be asked each time.
5. In **Settings > Standard notes**, write the short notes staff pick with F4 on a bill (for example "Delivered at site").
6. Bring in items and parties with **Add from a Spreadsheet**. Save a sample sheet, fill it in Excel, save as CSV, and choose it. Rows with problems are listed with the reason; fix them and import the file again.
7. Opening balances (what customers owed you, and stock on the first day) go in through the Opening balance and Opening stock columns.

## Every day

- At closing time: count the cash and compare with **Cash in hand** on the home screen.
- **Settings > Closing days and years > Close the day**. Staff can then no longer change that day's bills. You still can. If one of the latest days must be changed, use "keep closed up to" to reopen only the days after a date.
- Switch off the computer from the Windows Start menu, not the power button. ShopLedger makes a backup when it closes.

## Setting up label sheets

Before the first labels, open **Settings > Printing > Label sheets**. Choose the sheet you bought (24 labels of 70 x 37 mm, or 40 of 52.5 x 29.7 mm) and press **Print a test sheet** on plain paper. Hold it against a sheet of labels in front of a light. If the boxes sit lower than the labels, type a minus number in **Move down** (for example -1.5); if they sit to the right, a minus number in **Move right**. Save, print the test again, and repeat until the boxes match the labels. All label printing then uses these settings.

## Collecting money

Each morning open **Reports (R) > Money to Collect**. It lists only customers whose bills are late (older than their credit days, or 30 days when none are set), the largest first, with the phone number. Call them; when one pays, open them from the list (Enter on the name) and take the receipt with F6. Give a customer a printed statement with **Ctrl+P** on their page.

## Checking this computer

On the first day, and after a new printer, pen drive or computer, open **Settings > Locking, limits and support > Check this computer**. It prints a test page on the bill printer, makes a backup and reads it back (also from the pen drive), and checks the books, with one line for each. Fix anything marked "Problem" (the line says what to do) and run it again.

## Checking your books

Once a month, or whenever a figure looks wrong, open **Settings > Locking, limits and support > Check my books now**. It reads every bill and checks that the accounts, stock and bill numbers still add up; it changes nothing. If it says all is well, there is nothing to do. If it finds a problem: take a backup at once, do not change the bills it lists, and send the support file (same page) to whoever supports you.

## Giving your accountant the books

Open **Reports (R)**, scroll to **Data for the accountant**, choose the period and press **Save everything for my accountant**. Choose a folder (a pen drive is fine). It holds the bills, the ledger lines behind them, and your item, customer and supplier lists as spreadsheets, with a short note saying what each one is.

## Controlling credit and discounts

- **Credit limit:** open a customer (Customers, then F2) and type the most they may owe in **Credit limit**. Leave it empty for no limit. The customer page shows it.
- **Staff discount limit:** **Settings > Locking, limits and support > Discount staff may give**. Staff cannot save a bill with a bigger discount on any item, or taken off at the bottom. Leave empty for no limit.
- Every time you let a customer go above the limit it is recorded in **Who Did What**.

## Locking the screen and getting help

- ShopLedger hides the screen after 10 minutes without a key or the mouse and asks for the person's PIN. A bill being made is kept. Change the time, or switch it off with 0, in **Settings > Locking, limits and support**.
- If something is not working, open **Settings > Locking, limits and support > Save information for support** and send the file to whoever supports you. It describes the program, the data file's health, free disk space, the last backup and recent problems. It does not contain bills, customers, amounts or PINs.
- ShopLedger also keeps a short log of problems in its data folder (`logs`), at most six files of 1 MB.

## Backups

ShopLedger saves a backup by itself at 2 pm, 8 pm and each time it is closed. It keeps the last 30 days and one backup for each of the last 12 months.

- **Settings > Backup and restore** shows the last backup and the folder. The home screen warns when the last backup is more than two days old.
- Choose **a second copy** on a pen drive. A backup on the same computer is lost if the computer is lost. Plug the pen drive in at the end of each day and press **Back up now**.
- Once a month, take the pen drive home, or keep a second one there.

### Restoring

Use this if the data is damaged or the computer is replaced.

1. Install ShopLedger on the new computer and finish the welcome screen with any details (they will be replaced).
2. **Settings > Backup and restore > Choose a backup file**, pick the newest `shopledger-....db` file from the pen drive or the backup folder.
3. ShopLedger checks the file. If it is damaged it says so and changes nothing. Otherwise it shows how many bills the backup holds. Confirm.
4. Your current data is saved as a backup first, then the backup is put in place and ShopLedger restarts.
5. Everything entered after the backup was taken is lost from the screen. Enter it again from the paper slips.

Practise this once on a spare computer before you need it.

## Month end and GST

1. **Reports > GST Summary** shows output tax, input tax and the amount to pay, rate by rate.
2. **GSTR-1** saves the sheets for the return (B2B, B2C, HSN, documents issued). **GSTR-3B** saves tables 3.1 and 4. They are spreadsheets for you or your accountant to check; ShopLedger does not file for you.
3. After the return is filed, **Settings > Closing days and years > Lock the books** up to the last day of that month. Nobody can then change those bills. To correct one later, make a Sales Return or Purchase Return dated today.

## Financial year end (31 March)

1. Nothing needs doing on 1 April: the new year starts by itself, balances and stock carry forward and bill numbers start again from 1. Late bills and returns for March can still be entered in the old year.
2. When your accountant has finished the year, take a backup, then **Settings > Closing days and years > Close this year**. Nobody can then make or change bills in that year.
3. If a closed year must be corrected, press **Open this year again** next to it. This is recorded in Who Did What; tell your accountant about the change.

## Checking what happened

**Who Did What** lists every bill made, changed or cancelled, with the person, the time and the reason. Use it if a bill looks wrong.

## When to call support

- ShopLedger says it cannot open your shop data.
- A message asks you to call support, or the same problem repeats.
- Totals look wrong after a restore.

Have ready: the message, and from **F1 > About this computer** the data file location and data version.

## Go-live checklist (on the shop PC, before 1 April 2027)

These checks could not be done during development because they need the shop's own computer, printers and pen drive. Do them in this order. Print this page and fill in the last column (date, your initials, and Pass or Fail). If a step fails, stop, write down exactly what you saw, and send it with the support file (**Settings > Locking, limits and support > Save information for support**).

Where the installer comes from: on GitHub, open the repository's **Actions** tab, the newest green **CI** run, and download **ShopLedger-Setup** at the bottom of the page (kept for 14 days). Unzip it to get `ShopLedger-Setup-<version>.exe`.

| # | What to do | Passes when | Date, initials, result |
| --- | --- | --- | --- |
| 1 | Right-click `ShopLedger-Setup-<version>.exe` and choose **Run as administrator**. Windows may say it protected the PC: press **More info**, then **Run anyway** (the installer is not signed). | ShopLedger installs and opens on the welcome screen. A desktop icon is there. | |
| 2 | Finish the welcome screen and the **First day** steps above. Then restart Windows. | ShopLedger opens by itself after Windows starts. | |
| 3 | Double-click the desktop icon while ShopLedger is already open. | No second copy opens; the open window comes to the front. | |
| 4 | **Settings > Printing**: choose the receipt printer. Make a small cash bill (F8) and print it on the 80 mm roll. Open it again (D, Enter, Ctrl+P), choose A4 and print on the A4 printer. | Both printouts show the shop name, GST number, items, tax and total, nothing cut off at the edges. | |
| 5 | On a new sale, press **Alt+E** and print an estimate. Open a customer's page and press **Ctrl+P** to print a statement. | Estimate says "ESTIMATE" and "not a bill". Statement shows the right amount due. | |
| 6 | **Settings > Printing > Label sheets**: print a test sheet on plain paper, adjust **Move down** and **Move right** until it matches a sheet of labels (see **Setting up label sheets**), then print one real sheet of labels. | Every price sits inside its label. | |
| 7 | **Settings > Backup and restore**: choose the pen drive as the second copy and press **Back up now**. | The page shows the new backup with today's time, and the file is on the pen drive. | |
| 8 | **Settings > Locking, limits and support > Check this computer** (choose the paper of the bill printer). | It says "All three checks passed": the test page prints with its border on all four sides, the backup and the pen drive copy read back, and the books add up. | |
| 9 | Restore drill on a spare computer (not the shop PC): install ShopLedger there and follow **Restoring** above with the backup from step 7. | It shows the same number of bills, and **Reports > Trial Balance** for today shows the same totals as the shop PC. | |
| 10 | Power-cut test on the shop PC: make a bill and, while pressing F2 to save it, switch off the power at the wall. Switch on and start ShopLedger. | ShopLedger opens normally. The bill is either fully there (Find a Bill) or not there at all. **Check my books now** says all is well. | |
| 11 | Year change on the spare computer from step 9 (never on the shop PC): set the Windows date to 1 April 2027 and open ShopLedger. Make one bill. Then set the date back. | The bill is number 1 of 2027-28. Customer balances and stock are the same as on 31 March. | |
| 12 | Give your accountant one full month (**Reports > Data for the accountant**, and the GSTR-1 and GSTR-3B files) and ask them to check it against the paper bills. | The accountant agrees with the GST totals and the way tax is rounded on each line. | |
| 13 | Run the shop on ShopLedger for a few days alongside Busy, then decide. | You are happy to stop using Busy for new bills from 1 April 2027 (Busy stays installed to look things up). | |

Steps 10 and 11 are also tested automatically during development (a forced stop while saving, and a clock set to 1 April), but only the real PC can prove them.
