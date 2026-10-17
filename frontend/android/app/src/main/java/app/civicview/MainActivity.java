package app.civicview;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugin (2026-10-17): notification status and the
        // settings page. Registered before the bridge starts.
        registerPlugin(NotificationSettingsPlugin.class);
        super.onCreate(savedInstanceState);
        NotificationChannels.ensure(this);
    }
}
