package in.nairsolutions.cafe;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppInfoPlugin.class);
        super.onCreate(savedInstanceState);
        // Keep text at 100% so a large system font size doesn't push cards and tables off the screen
        if (getBridge() != null) getBridge().getWebView().getSettings().setTextZoom(100);
        AlarmMessagingService.ensureChannels(this);
        // Opened from an alert: go straight to its page
        String link = getIntent().getStringExtra("link");
        if (link != null && !link.isEmpty()) openLink(link);
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        String link = intent.getStringExtra("link");
        if (link != null && !link.isEmpty()) openLink(link);
    }

    private void openLink(String link) {
        if (getBridge() == null) return;
        String js = "window.location.assign(" + org.json.JSONObject.quote(link) + ")";
        getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(js, null));
    }
}
