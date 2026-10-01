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
- **Settings > Closing days and years > Close the day**. Staff can then no longer change that day's bills. You still can.
- Switch off the computer from the Windows Start menu, not the power button. ShopLedger makes a backup when it closes.

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

1. Make sure every return and report for the year is done and take a backup.
2. **Settings > Closing days and years > Close this year**. The next year is created, balances and stock carry forward and bill numbers start again from 1. The closed year is locked.
3. If a closed year must be corrected, call support.

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
