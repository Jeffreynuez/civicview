// CivicView. Copyright (c) 2026 Jeffrey De La Nuez. All rights reserved.
// Proprietary and confidential. See LICENSE at the repository root.

package app.civicview;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.service.notification.StatusBarNotification;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Builds CivicView's notifications on the phone (2026-10-17, app 1.2.0).
 *
 * The server sends this app build data-only messages (cv_v = "1"), so
 * the app, not Firebase, draws the notification: the right channel, the
 * monochrome status bar icon and brand colour, a group per channel with
 * a summary once 3 or more are in the tray, and a tag so a newer update
 * on the same event, bill or poll replaces the older one.
 *
 * Privacy: unless the person chose "Show details" (cv_details = "1"),
 * the server sends only a neutral line as the title ("New update from
 * an official you track") and no body, and the group summary lists no
 * titles. That is what keeps a lock screen private on every phone:
 * Android shows a notification's public version only when the person
 * has hidden sensitive content in Android's own settings, which most
 * phones do not. The public version is still set (the same text).
 *
 * It extends the Capacitor plugin's service, which it replaces in the
 * manifest, and hands every message on to it, so the web app still
 * hears about the push (the bell refreshes) and a tap still reaches
 * lib/push.js through pushNotificationActionPerformed: the tap opens
 * MainActivity with the message's data and a google.message_id, which
 * is what the plugin looks for.
 *
 * A message without cv_v (an older server) is left to Firebase as
 * before.
 */
public class CivicViewMessagingService extends MessagingService {

    private static final String TAG = "CivicViewPush";
    private static final String PREFIX = "cv_";
    private static final int TAGGED_ID = 1;
    private static final int SUMMARY_ID = 2;
    private static final int GROUP_SUMMARY_AT = 3;
    private static final int INBOX_LINES = 5;

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> data = message.getData();
        if (message.getNotification() == null && "1".equals(data.get("cv_v"))) {
            try {
                show(this, message.getMessageId(), data);
            } catch (Exception e) {
                Log.w(TAG, "could not show a notification", e);
            }
        }
        super.onMessageReceived(message);
    }

    @Override
    public void onNewToken(@NonNull String token) {
        // The plugin's service hands a new token to the web app, which
        // registers it (lib/push.js).
        super.onNewToken(token);
    }

    static void show(Context context, String messageId, Map<String, String> data) {
        NotificationChannels.ensure(context);
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        String channel = data.get("cv_channel");
        if (!NotificationChannels.isKnown(channel)) channel = NotificationChannels.OFFICIALS;
        String title = orEmpty(data.get("cv_title"));
        String body = orEmpty(data.get("cv_body"));
        boolean details = "1".equals(data.get("cv_details"));
        String tag = data.get("cv_tag");
        String group = "cv." + channel;
        String id = messageId != null ? messageId : String.valueOf(System.currentTimeMillis());
        int requestCode = (tag != null ? tag : id).hashCode();
        int color = ContextCompat.getColor(context, R.color.cv_notification_accent);

        NotificationCompat.Builder publicBuilder = new NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat_civicview)
            .setColor(color)
            .setContentTitle(orEmpty(data.get("cv_public_title")));
        String publicBody = orEmpty(data.get("cv_public_body"));
        if (!publicBody.isEmpty()) publicBuilder.setContentText(publicBody);
        Notification publicVersion = publicBuilder.build();

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat_civicview)
            .setColor(color)
            .setContentTitle(title)
            .setAutoCancel(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion)
            .setGroup(group)
            .setPriority(priority(channel))
            .setContentIntent(tapIntent(context, id, requestCode, data));
        if (!body.isEmpty()) {
            builder.setContentText(body).setStyle(new NotificationCompat.BigTextStyle().bigText(body));
        }

        String postedTag = tag;
        int postedId = tag != null ? TAGGED_ID : requestCode;
        nm.notify(postedTag, postedId, builder.build());
        maybeSummarize(context, nm, channel, group, data, color, postedTag, postedId, title, details);
    }

    /**
     * A group summary once GROUP_SUMMARY_AT or more of one channel are
     * showing, counting the one just posted: notify() is asynchronous,
     * so getActiveNotifications() may not list it yet. Below the
     * threshold any earlier summary is left alone (Android removes it
     * with its last child).
     */
    private static void maybeSummarize(Context context, NotificationManager nm, String channel, String group,
                                       Map<String, String> data, int color, String postedTag, int postedId,
                                       String postedTitle, boolean details) {
        List<String> titles = new ArrayList<>();
        titles.add(postedTitle);
        for (StatusBarNotification sbn : nm.getActiveNotifications()) {
            Notification n = sbn.getNotification();
            if (n == null || !group.equals(n.getGroup())) continue;
            if ((n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) continue;
            if (sbn.getId() == postedId && java.util.Objects.equals(sbn.getTag(), postedTag)) continue;
            CharSequence t = n.extras.getCharSequence(Notification.EXTRA_TITLE);
            titles.add(t != null ? t.toString() : "");
        }
        if (titles.size() < GROUP_SUMMARY_AT) return;
        String count = String.valueOf(titles.size());
        String groupTitle = orEmpty(data.get("cv_group_title")).replace("{n}", count);
        String groupPublic = orEmpty(data.get("cv_group_public")).replace("{n}", count);

        Notification publicSummary = new NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat_civicview)
            .setColor(color)
            .setContentTitle(groupPublic)
            .build();

        Map<String, String> open = new java.util.HashMap<>();
        open.put("kind", "tracked_summary");
        open.put("count", count);
        NotificationCompat.Builder summary = new NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat_civicview)
            .setColor(color)
            .setContentTitle(groupTitle)
            .setGroup(group)
            .setGroupSummary(true)
            .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
            .setAutoCancel(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(publicSummary)
            .setContentIntent(tapIntent(context, "summary-" + channel, ("summary-" + channel).hashCode(), open));
        if (details) {
            // Who posted and what, newest first: only when the person
            // chose to see details.
            NotificationCompat.InboxStyle inbox = new NotificationCompat.InboxStyle().setBigContentTitle(groupTitle);
            for (int i = 0; i < titles.size() && i < INBOX_LINES; i++) inbox.addLine(titles.get(i));
            summary.setContentText(titles.get(0)).setStyle(inbox);
        }
        nm.notify("cv.summary." + channel, SUMMARY_ID, summary.build());
    }

    /**
     * Opens MainActivity with the push's own data (not the cv_ display
     * keys) and a google.message_id, the extra the Capacitor plugin
     * turns into pushNotificationActionPerformed for lib/push.js.
     */
    private static PendingIntent tapIntent(Context context, String messageId, int requestCode,
                                           Map<String, String> data) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setAction("app.civicview.PUSH_TAP." + requestCode);
        intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        for (Map.Entry<String, String> e : data.entrySet()) {
            if (e.getKey() == null || e.getKey().startsWith(PREFIX)) continue;
            intent.putExtra(e.getKey(), e.getValue());
        }
        intent.putExtra("google.message_id", messageId);
        return PendingIntent.getActivity(context, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Before Android 8 there are no channels: priority stands in for importance. */
    private static int priority(String channel) {
        int importance = NotificationChannels.importance(channel);
        if (importance >= NotificationManager.IMPORTANCE_HIGH) return NotificationCompat.PRIORITY_HIGH;
        if (importance <= NotificationManager.IMPORTANCE_LOW) return NotificationCompat.PRIORITY_LOW;
        return NotificationCompat.PRIORITY_DEFAULT;
    }

    private static String orEmpty(String s) {
        return s != null ? s : "";
    }
}
