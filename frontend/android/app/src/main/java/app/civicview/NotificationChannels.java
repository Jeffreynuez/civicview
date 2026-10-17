// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

package app.civicview;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;
import androidx.annotation.RequiresApi;

/**
 * The app's notification channels (2026-10-17). Each kind of alert has
 * its own, so a person can mute one in Android settings without losing
 * the rest. Every channel hides its notifications' content on a secure
 * lock screen (Private): the lock screen shows each notification's
 * neutral public version instead (CivicViewMessagingService), unless the
 * person chose "Show details" in CivicView's notification settings.
 *
 * Created at app start (MainActivity) and before each push is shown, so
 * they exist even when a push arrives before the app is first opened
 * after an update. lib/push.js also re-asserts the names and
 * descriptions from the web app, so their wording can change with a web
 * deploy. The ids are the channel names the server sends
 * (backend/app/services/push_service.py CHANNELS); keep them in step.
 */
public final class NotificationChannels {

    public static final String OFFICIALS = "officials";
    public static final String EVENTS = "events";
    public static final String REPLIES = "replies";
    public static final String BILLS = "bills";
    public static final String POLL_RESULTS = "poll_results";
    public static final String ELECTIONS = "elections";
    public static final String PAGE_CHANGES = "page_changes";
    public static final String SUMMARIES = "summaries";

    public static final String[] ALL = {
        OFFICIALS, EVENTS, REPLIES, BILLS, POLL_RESULTS, ELECTIONS, PAGE_CHANGES, SUMMARIES,
    };

    private NotificationChannels() {}

    public static boolean isKnown(String id) {
        if (id == null) return false;
        for (String known : ALL) {
            if (known.equals(id)) return true;
        }
        return false;
    }

    /** Importance per channel: replies and election reminders pop up. */
    public static int importance(String id) {
        if (REPLIES.equals(id) || ELECTIONS.equals(id)) return NotificationManager.IMPORTANCE_HIGH;
        if (PAGE_CHANGES.equals(id)) return NotificationManager.IMPORTANCE_LOW;
        return NotificationManager.IMPORTANCE_DEFAULT;
    }

    public static void ensure(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm == null) return;
        create(context, nm, OFFICIALS, R.string.channel_officials, R.string.channel_officials_desc);
        create(context, nm, EVENTS, R.string.channel_events, R.string.channel_events_desc);
        create(context, nm, REPLIES, R.string.channel_replies, R.string.channel_replies_desc);
        create(context, nm, BILLS, R.string.channel_bills, R.string.channel_bills_desc);
        create(context, nm, POLL_RESULTS, R.string.channel_poll_results, R.string.channel_poll_results_desc);
        create(context, nm, ELECTIONS, R.string.channel_elections, R.string.channel_elections_desc);
        create(context, nm, PAGE_CHANGES, R.string.channel_page_changes, R.string.channel_page_changes_desc);
        create(context, nm, SUMMARIES, R.string.channel_summaries, R.string.channel_summaries_desc);
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private static void create(Context context, NotificationManager nm, String id, int name, int description) {
        // Creating a channel that exists only updates its name and
        // description; the person's own choices for it are kept.
        NotificationChannel channel = new NotificationChannel(id, context.getString(name), importance(id));
        channel.setDescription(context.getString(description));
        channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        channel.setShowBadge(true);
        nm.createNotificationChannel(channel);
    }
}
