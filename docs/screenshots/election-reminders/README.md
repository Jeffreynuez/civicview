# Election reminders: local boot, 2026-10-16

Taken from a local boot with `ELECTION_REMINDERS_ENABLED=true` and the
clock set with `ELECTION_REMINDERS_NOW` (local testing only; production
ignores it). The account is a demo California citizen with a push
device and reminder emails turned on.

1. `01-admin-preview.png`: Admin, Election reminders, clock at Friday,
   October 16, 10:05 a.m. Pacific. California and Pennsylvania's "3 days
   before" registration reminders are sending today; the rest are
   scheduled; Florida and Texas registration reminders had passed.
2. `02-bell-reminder.png`: clock at Sunday, October 18, 10:05 a.m.
   Pacific. The bell row: title, sentence, official link, the source of
   the date, I already voted and Turn off election reminders.
3. `03-bell-already-voted.png`: after I already voted, with Undo.
4. `04-bell-settings.png`: the bell's notification settings with the
   Election reminders switch and the email opt-in.
5. `05-dashboard-settings.png`: the same switches in Account & settings,
   where the email footer link lands.
6. `06-email.png`: the opt-in email for the same reminder.
7. `07-admin-not-sent.png`: the reminders that are not sent, with the
   reason and the official source.

The same run, from the backend log (the dev push and email services
log instead of sending):

```
[dev-push] would send to 1 token(s): 'California voter registration closes tomorrow' / 'Tomorrow, Monday, October 19, is the last day to register to vote in California for the November 3 general election. ...' data={'kind': 'election_reminder', 'reminder_id': 'ca-2026-11-03-registration-1d', 'state': 'CA'} ttl=136440
EMAIL (dev, not sent) to=maria.demo@example.org
```

ttl=136440 seconds is 37 hours and 54 minutes: from 10:05 a.m.
Pacific on October 18 to 11:59 p.m. Pacific on October 19, the
deadline. The October 16 run's "3 days before" push carried
ttl=309240, which ends at the same moment.
