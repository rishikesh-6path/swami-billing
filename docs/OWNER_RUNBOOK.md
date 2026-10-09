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

## Checks that need doing on the shop PC (not possible during development)

- Print a real bill on the shop's printer, on A4 and on the receipt roll.
- Run the installer, restart Windows and confirm ShopLedger opens by itself.
- Take a backup to the pen drive, then run a full restore on a spare computer.
- Pull the power while a bill is being saved, start again, and confirm the bill is either complete or absent, never half there (an automated process-kill version of this runs in the test suite).
- Have the accountant check the GST outputs against one month of real bills.
