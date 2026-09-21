package com.factorylm.mira;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BuildConfig")
public class BuildConfigPlugin extends Plugin {

    @PluginMethod
    public void getApiBase(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("apiBase", BuildConfig.API_BASE);
        call.resolve(ret);
    }
}
