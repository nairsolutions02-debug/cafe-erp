package in.nairsolutions.cafe;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

// Receives alerts from the push-notify function. Alarm-style alerts ring full screen (even when
// the phone is locked) until acknowledged; loud ones ring once; normal ones are silent.
public class AlarmMessagingService extends MessagingService {
    static final String ALARM = "alarms";
    static final String LOUD = "loud";
    static final String NORMAL = "normal";

    @Override
    public void onMessageReceived(@NonNull RemoteMessage msg) {
        super.onMessageReceived(msg);
        Map<String, String> d = msg.getData();
        if (d.isEmpty() || d.get("title") == null) return;
        show(this, d.get("id"), d.get("title"), d.get("body"), d.get("link"), d.get("style"));
    }

    static void ensureChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        AudioAttributes alarmAudio = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build();
        NotificationChannel alarm = new NotificationChannel(ALARM, "Alarms (orders, payments)", NotificationManager.IMPORTANCE_HIGH);
        alarm.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), alarmAudio);
        alarm.enableVibration(true);
        alarm.setVibrationPattern(new long[] { 0, 600, 300, 600, 300, 600 });
        alarm.setBypassDnd(true);
        nm.createNotificationChannel(alarm);
        NotificationChannel loud = new NotificationChannel(LOUD, "Important alerts", NotificationManager.IMPORTANCE_HIGH);
        nm.createNotificationChannel(loud);
        NotificationChannel normal = new NotificationChannel(NORMAL, "Other alerts", NotificationManager.IMPORTANCE_LOW);
        nm.createNotificationChannel(normal);
    }

    static void show(Context ctx, String id, String title, String body, String link, String style) {
        ensureChannels(ctx);
        int nid = id != null ? id.hashCode() : (int) System.currentTimeMillis();
        boolean alarm = "alarm".equals(style);
        Intent open = new Intent(ctx, MainActivity.class).putExtra("link", link).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(ctx, nid, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, alarm ? ALARM : "loud".equals(style) ? LOUD : NORMAL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(tap);
        if (alarm) {
            Intent full = new Intent(ctx, AlarmActivity.class)
                .putExtra("id", nid).putExtra("title", title).putExtra("body", body).putExtra("link", link)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent fullPi = PendingIntent.getActivity(ctx, nid + 1, full, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            b.setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setFullScreenIntent(fullPi, true)
                .setOngoing(true);
        }
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        android.app.Notification n = b.build();
        if (alarm) n.flags |= android.app.Notification.FLAG_INSISTENT; // keep ringing until opened
        nm.notify(nid, n);
    }
}
