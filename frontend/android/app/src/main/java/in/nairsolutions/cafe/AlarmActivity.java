package in.nairsolutions.cafe;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

// Full-screen alarm shown over the lock screen; the ring stops when someone opens it
public class AlarmActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        Intent in = getIntent();
        int id = in.getIntExtra("id", 0);
        String link = in.getStringExtra("link");

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setPadding(48, 48, 48, 48);
        box.setBackgroundColor(Color.rgb(160, 20, 20));

        TextView title = new TextView(this);
        title.setText(in.getStringExtra("title"));
        title.setTextColor(Color.WHITE);
        title.setTextSize(30);
        title.setGravity(Gravity.CENTER);
        box.addView(title);

        TextView body = new TextView(this);
        body.setText(in.getStringExtra("body"));
        body.setTextColor(Color.WHITE);
        body.setTextSize(20);
        body.setGravity(Gravity.CENTER);
        body.setPadding(0, 24, 0, 48);
        box.addView(body);

        Button open = new Button(this);
        open.setText("Open");
        open.setTextSize(22);
        open.setOnClickListener(v -> {
            stopRinging(id);
            startActivity(new Intent(this, MainActivity.class).putExtra("link", link)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP));
            finish();
        });
        box.addView(open);

        Button later = new Button(this);
        later.setText("Snooze 5 min");
        later.setOnClickListener(v -> {
            stopRinging(id);
            final String t = in.getStringExtra("title");
            final String b = in.getStringExtra("body");
            final Context app = getApplicationContext();
            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(
                () -> AlarmMessagingService.show(app, String.valueOf(id), t, b, link, "alarm"), 5 * 60 * 1000);
            finish();
        });
        box.addView(later);

        setContentView(box);
    }

    private void stopRinging(int id) {
        ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).cancel(id);
    }
}
