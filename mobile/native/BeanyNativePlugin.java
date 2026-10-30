package dev.greenybeany.beanydrive;

// BeanyDrive's own Android plugin: what the WebView can't do by itself.
//
//   Downloads   createDownload / appendDownload / finishDownload write a file
//               straight into MediaStore — photos and videos land in
//               Pictures/BeanyDrive and Movies/BeanyDrive (so the gallery sees
//               them), everything else in Download/BeanyDrive.
//   Share to    files shared to BeanyDrive from another app arrive as content
//               URIs; getSharedFiles hands them over, readRange reads them.
//   Camera      listMedia finds new photos and videos in DCIM for backup.
//   Streaming   /_beanystream/<id> requests from <video> are answered here with
//               206 ranges whose bytes JavaScript feeds in (streamData), since
//               the bytes come from the drive core running in the page.
//
// mobile/android is generated in CI, so this file is copied in and registered
// by mobile/native/install.mjs.

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;

@CapacitorPlugin(
    name = "BeanyNative",
    permissions = {
        @Permission(alias = "media", strings = { Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO }),
        @Permission(alias = "mediaLegacy", strings = { Manifest.permission.READ_EXTERNAL_STORAGE }),
        @Permission(alias = "storageLegacy", strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }),
    }
)
public class BeanyNativePlugin extends Plugin {

    private static final String STREAM_PATH = "/_beanystream/";
    private static final long STREAM_SPAN = 4L * 1024 * 1024;

    private final ExecutorService io = Executors.newCachedThreadPool();
    private final Map<String, Download> downloads = new ConcurrentHashMap<>();
    private final Map<String, QueueStream> streams = new ConcurrentHashMap<>();
    private final List<JSObject> pendingShared = new ArrayList<>();

    private static class Download {
        OutputStream out;
        Uri uri;      // MediaStore entry (Android 10+)
        File file;    // plain file (Android 9 and older)
        String location;
    }

    @Override
    public void load() {
        takeSharedFrom(getActivity().getIntent());
        getActivity().runOnUiThread(() -> bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                String path = u.getPath();
                if (path != null && path.startsWith(STREAM_PATH)) return streamResponse(u, request);
                return super.shouldInterceptRequest(view, request);
            }
        }));
    }

    // ---- downloads ---------------------------------------------------------

    @PluginMethod
    public void createDownload(PluginCall call) {
        if (Build.VERSION.SDK_INT < 29 && getPermissionState("storageLegacy") != PermissionState.GRANTED) {
            requestPermissionForAlias("storageLegacy", call, "storageCallback");
            return;
        }
        startDownload(call);
    }

    @PermissionCallback
    private void storageCallback(PluginCall call) {
        if (getPermissionState("storageLegacy") == PermissionState.GRANTED) startDownload(call);
        else call.reject("BeanyDrive needs storage permission to save files");
    }

    private void startDownload(PluginCall call) {
        String name = call.getString("name", "download");
        String mime = call.getString("mime", "application/octet-stream");
        io.execute(() -> {
            try {
                Download d = Build.VERSION.SDK_INT >= 29 ? mediaStoreDownload(name, mime) : legacyDownload(name);
                String id = UUID.randomUUID().toString();
                downloads.put(id, d);
                JSObject r = new JSObject();
                r.put("id", id);
                r.put("location", d.location);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Couldn't create the file: " + e.getMessage());
            }
        });
    }

    private Download mediaStoreDownload(String name, String mime) throws IOException {
        ContentResolver cr = getContext().getContentResolver();
        Uri collection;
        String dir;
        if (mime.startsWith("image/")) {
            collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
            dir = Environment.DIRECTORY_PICTURES;
        } else if (mime.startsWith("video/")) {
            collection = MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
            dir = Environment.DIRECTORY_MOVIES;
        } else if (mime.startsWith("audio/")) {
            collection = MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
            dir = Environment.DIRECTORY_MUSIC;
        } else {
            collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
            dir = Environment.DIRECTORY_DOWNLOADS;
        }
        Uri uri = null;
        try {
            uri = cr.insert(collection, pendingValues(name, mime, dir));
        } catch (Exception e) {
            // A media collection can refuse a type it doesn't know; Downloads takes anything.
        }
        if (uri == null) {
            dir = Environment.DIRECTORY_DOWNLOADS;
            uri = cr.insert(MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), pendingValues(name, mime, dir));
        }
        if (uri == null) throw new IOException("MediaStore refused the file");
        Download d = new Download();
        d.uri = uri;
        d.out = cr.openOutputStream(uri);
        if (d.out == null) throw new IOException("Couldn't open the file for writing");
        d.location = dir + "/BeanyDrive";
        return d;
    }

    private static ContentValues pendingValues(String name, String mime, String dir) {
        ContentValues v = new ContentValues();
        v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        v.put(MediaStore.MediaColumns.RELATIVE_PATH, dir + "/BeanyDrive");
        v.put(MediaStore.MediaColumns.IS_PENDING, 1);
        return v;
    }

    private Download legacyDownload(String name) throws IOException {
        File folder = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "BeanyDrive");
        if (!folder.isDirectory() && !folder.mkdirs()) throw new IOException("Couldn't create Download/BeanyDrive");
        File f = new File(folder, name);
        int dot = name.lastIndexOf('.');
        String stem = dot > 0 ? name.substring(0, dot) : name;
        String ext = dot > 0 ? name.substring(dot) : "";
        for (int n = 1; f.exists(); n++) f = new File(folder, stem + " (" + n + ")" + ext);
        Download d = new Download();
        d.file = f;
        d.out = new FileOutputStream(f);
        d.location = "Download/BeanyDrive";
        return d;
    }

    @PluginMethod
    public void appendDownload(PluginCall call) {
        Download d = downloads.get(call.getString("id", ""));
        if (d == null) { call.reject("Unknown download"); return; }
        String data = call.getString("data", "");
        io.execute(() -> {
            try {
                synchronized (d) { d.out.write(Base64.decode(data, Base64.DEFAULT)); }
                call.resolve();
            } catch (Exception e) {
                call.reject("Write failed: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void finishDownload(PluginCall call) {
        Download d = downloads.remove(call.getString("id", ""));
        if (d == null) { call.reject("Unknown download"); return; }
        io.execute(() -> {
            try {
                synchronized (d) { d.out.close(); }
                JSObject r = new JSObject();
                if (d.uri != null) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    getContext().getContentResolver().update(d.uri, v, null, null);
                    r.put("uri", d.uri.toString());
                } else {
                    MediaScannerConnection.scanFile(getContext(), new String[] { d.file.getAbsolutePath() }, null, null);
                    r.put("uri", Uri.fromFile(d.file).toString());
                    r.put("file", d.file.getAbsolutePath());
                }
                r.put("location", d.location);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Couldn't finish the file: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void abortDownload(PluginCall call) {
        Download d = downloads.remove(call.getString("id", ""));
        if (d != null) {
            io.execute(() -> {
                try { d.out.close(); } catch (IOException ignored) { }
                if (d.uri != null) getContext().getContentResolver().delete(d.uri, null, null);
                if (d.file != null) d.file.delete();
            });
        }
        call.resolve();
    }

    @PluginMethod
    public void openFile(PluginCall call) {
        try {
            String file = call.getString("file");
            Uri uri = file != null
                ? FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", new File(file))
                : Uri.parse(call.getString("uri", ""));
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, call.getString("mime", "*/*"));
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("No app on this phone opens this kind of file");
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    // ---- files shared to BeanyDrive ---------------------------------------

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (takeSharedFrom(intent)) notifyListeners("shared", new JSObject(), true);
    }

    private boolean takeSharedFrom(Intent intent) {
        if (intent == null) return false;
        String action = intent.getAction();
        List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri u = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) uris.add(u);
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> list = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) uris.addAll(list);
        }
        if (uris.isEmpty()) return false;
        // Handled once: a reload of the page mustn't queue the same files again.
        intent.setAction(null);
        synchronized (pendingShared) {
            for (Uri u : uris) pendingShared.add(describe(u, intent.getType()));
        }
        return true;
    }

    private JSObject describe(Uri uri, String fallbackMime) {
        JSObject o = new JSObject();
        o.put("uri", uri.toString());
        String name = uri.getLastPathSegment();
        long size = -1;
        try (Cursor c = getContext().getContentResolver().query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int ni = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int si = c.getColumnIndex(OpenableColumns.SIZE);
                if (ni >= 0 && c.getString(ni) != null) name = c.getString(ni);
                if (si >= 0 && !c.isNull(si)) size = c.getLong(si);
            }
        } catch (Exception ignored) { }
        if (size < 0) {
            try (ParcelFileDescriptor pfd = getContext().getContentResolver().openFileDescriptor(uri, "r")) {
                if (pfd != null) size = pfd.getStatSize();
            } catch (Exception ignored) { }
        }
        String mime = getContext().getContentResolver().getType(uri);
        o.put("name", name == null ? "shared file" : name);
        o.put("size", Math.max(0, size));
        o.put("mime", mime != null ? mime : (fallbackMime != null ? fallbackMime : "application/octet-stream"));
        return o;
    }

    @PluginMethod
    public void getSharedFiles(PluginCall call) {
        JSArray arr = new JSArray();
        synchronized (pendingShared) {
            for (JSObject o : pendingShared) arr.put(o);
            pendingShared.clear();
        }
        JSObject r = new JSObject();
        r.put("files", arr);
        call.resolve(r);
    }

    // Positional read of a content URI, for uploading shared files and camera
    // backups without copying them first.
    @PluginMethod
    public void readRange(PluginCall call) {
        String uriStr = call.getString("uri", "");
        long offset = longArg(call, "offset");
        int length = call.getInt("length", 0);
        io.execute(() -> {
            try {
                byte[] buf = readAt(Uri.parse(uriStr), offset, length);
                JSObject r = new JSObject();
                r.put("data", Base64.encodeToString(buf, Base64.NO_WRAP));
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Couldn't read the file: " + e.getMessage());
            }
        });
    }

    // PluginCall.getLong only accepts values JSON parsed as Long, so any number
    // under 2^31 (an Integer) came back as the default: every chunk was read
    // from offset 0. optLong takes whatever numeric type it was parsed as.
    private static long longArg(PluginCall call, String name) {
        return call.getData().optLong(name, 0L);
    }

    private byte[] readAt(Uri uri, long offset, int length) throws IOException {
        ContentResolver cr = getContext().getContentResolver();
        byte[] buf = new byte[length];
        int got = 0;
        try (ParcelFileDescriptor pfd = cr.openFileDescriptor(uri, "r");
             FileInputStream in = new FileInputStream(pfd.getFileDescriptor())) {
            in.getChannel().position(offset);
            while (got < length) {
                int n = in.read(buf, got, length - got);
                if (n < 0) break;
                got += n;
            }
        } catch (IOException | RuntimeException seekFailed) {
            // Not every provider hands out a seekable descriptor; read through instead.
            got = 0;
            try (InputStream in = cr.openInputStream(uri)) {
                if (in == null) throw new IOException("Provider returned no stream");
                long skipped = 0;
                while (skipped < offset) {
                    long n = in.skip(offset - skipped);
                    if (n <= 0) break;
                    skipped += n;
                }
                while (got < length) {
                    int n = in.read(buf, got, length - got);
                    if (n < 0) break;
                    got += n;
                }
            }
        }
        if (got == length) return buf;
        byte[] out = new byte[got];
        System.arraycopy(buf, 0, out, 0, got);
        return out;
    }

    // ---- camera backup ------------------------------------------------------

    private String mediaAlias() {
        return Build.VERSION.SDK_INT >= 33 ? "media" : "mediaLegacy";
    }

    @PluginMethod
    public void requestMediaPermission(PluginCall call) {
        if (getPermissionState(mediaAlias()) == PermissionState.GRANTED) { resolveGranted(call); return; }
        requestPermissionForAlias(mediaAlias(), call, "mediaCallback");
    }

    @PluginMethod
    public void mediaPermission(PluginCall call) {
        resolveGranted(call);
    }

    @PermissionCallback
    private void mediaCallback(PluginCall call) {
        resolveGranted(call);
    }

    private void resolveGranted(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", getPermissionState(mediaAlias()) == PermissionState.GRANTED);
        call.resolve(r);
    }

    // Photos and videos in DCIM (the camera's folder) added after `since`
    // (epoch ms), oldest first.
    @PluginMethod
    public void listMedia(PluginCall call) {
        long since = longArg(call, "since");
        int limit = call.getInt("limit", 50);
        io.execute(() -> {
            try {
                List<JSObject> items = new ArrayList<>();
                queryMedia(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, "img", since, limit, items);
                queryMedia(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, "vid", since, limit, items);
                items.sort((a, b) -> Long.compare(a.optLong("added"), b.optLong("added")));
                JSArray arr = new JSArray();
                for (int i = 0; i < Math.min(limit, items.size()); i++) arr.put(items.get(i));
                JSObject r = new JSObject();
                r.put("items", arr);
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Couldn't read the gallery: " + e.getMessage());
            }
        });
    }

    private void queryMedia(Uri collection, String kind, long sinceMs, int limit, List<JSObject> out) {
        String[] projection = {
            MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.SIZE,
            MediaStore.MediaColumns.DATE_ADDED, MediaStore.MediaColumns.MIME_TYPE,
        };
        String where = MediaStore.MediaColumns.DATE_ADDED + " >= ? AND "
            + (Build.VERSION.SDK_INT >= 29 ? MediaStore.MediaColumns.RELATIVE_PATH : MediaStore.MediaColumns.DATA) + " LIKE ?";
        String[] args = { String.valueOf(sinceMs / 1000), Build.VERSION.SDK_INT >= 29 ? "DCIM/%" : "%/DCIM/%" };
        String order = MediaStore.MediaColumns.DATE_ADDED + " ASC";
        try (Cursor c = getContext().getContentResolver().query(collection, projection, where, args, order)) {
            if (c == null) return;
            while (c.moveToNext() && out.size() < limit * 2) {
                long id = c.getLong(0);
                JSObject o = new JSObject();
                o.put("key", kind + ":" + id);
                o.put("uri", ContentUris.withAppendedId(collection, id).toString());
                o.put("name", c.getString(1));
                o.put("size", c.getLong(2));
                o.put("added", c.getLong(3) * 1000);
                o.put("mime", c.getString(4));
                out.add(o);
            }
        }
    }

    // ---- streaming ----------------------------------------------------------

    // An InputStream fed from JavaScript one piece at a time. An empty array
    // marks the end.
    private static class QueueStream extends InputStream {
        private final LinkedBlockingQueue<byte[]> queue = new LinkedBlockingQueue<>();
        private byte[] current = new byte[0];
        private int pos = 0;
        private boolean ended = false;
        volatile boolean closed = false;

        void push(byte[] b) { queue.offer(b); }
        void end() { queue.offer(new byte[0]); }

        private boolean fill() throws IOException {
            while (pos >= current.length) {
                if (ended || closed) return false;
                try {
                    current = queue.take();
                } catch (InterruptedException e) {
                    throw new IOException("Interrupted");
                }
                pos = 0;
                if (current.length == 0) { ended = true; return false; }
            }
            return true;
        }

        @Override
        public int read() throws IOException {
            return fill() ? (current[pos++] & 0xff) : -1;
        }

        @Override
        public int read(byte[] b, int off, int len) throws IOException {
            if (!fill()) return -1;
            int n = Math.min(len, current.length - pos);
            System.arraycopy(current, pos, b, off, n);
            pos += n;
            return n;
        }

        @Override
        public void close() {
            closed = true;
            queue.offer(new byte[0]);
        }
    }

    private WebResourceResponse streamResponse(Uri u, WebResourceRequest request) {
        String fileId = u.getLastPathSegment();
        long size;
        try {
            size = Long.parseLong(u.getQueryParameter("size"));
        } catch (Exception e) {
            return new WebResourceResponse("text/plain", "utf-8", 400, "Bad Request", null, null);
        }
        String type = u.getQueryParameter("type");
        if (type == null) type = "application/octet-stream";
        Map<String, String> reqHeaders = request.getRequestHeaders();
        String range = reqHeaders.get("Range") != null ? reqHeaders.get("Range") : reqHeaders.get("range");

        long start = 0;
        long end = Math.min(size - 1, STREAM_SPAN - 1);
        if (range != null && range.startsWith("bytes=")) {
            String[] p = range.substring(6).split("-", -1);
            try {
                if (!p[0].isEmpty()) {
                    start = Long.parseLong(p[0]);
                    end = p.length > 1 && !p[1].isEmpty() ? Math.min(Long.parseLong(p[1]), size - 1) : Math.min(size - 1, start + STREAM_SPAN - 1);
                } else if (p.length > 1 && !p[1].isEmpty()) {
                    start = Math.max(0, size - Long.parseLong(p[1]));
                    end = size - 1;
                }
            } catch (NumberFormatException ignored) { }
        }
        Map<String, String> headers = new HashMap<>();
        headers.put("Accept-Ranges", "bytes");
        headers.put("Cache-Control", "no-store");
        if (size <= 0 || start >= size || start > end) {
            headers.put("Content-Range", "bytes */" + size);
            return new WebResourceResponse(type, null, 416, "Range Not Satisfiable", headers, null);
        }
        headers.put("Content-Range", "bytes " + start + "-" + end + "/" + size);
        headers.put("Content-Length", String.valueOf(end - start + 1));

        String req = UUID.randomUUID().toString();
        QueueStream stream = new QueueStream();
        streams.put(req, stream);
        JSObject ev = new JSObject();
        ev.put("req", req);
        ev.put("fileId", fileId);
        ev.put("start", start);
        ev.put("end", end);
        notifyListeners("streamRequest", ev);
        return new WebResourceResponse(type, null, 206, "Partial Content", headers, stream);
    }

    // Returns { open: false } once the player has hung up, so the page stops
    // fetching for it.
    @PluginMethod
    public void streamData(PluginCall call) {
        QueueStream s = streams.get(call.getString("req", ""));
        JSObject r = new JSObject();
        if (s == null || s.closed) {
            streams.remove(call.getString("req", ""));
            r.put("open", false);
        } else {
            s.push(Base64.decode(call.getString("data", ""), Base64.DEFAULT));
            r.put("open", true);
        }
        call.resolve(r);
    }

    @PluginMethod
    public void streamEnd(PluginCall call) {
        QueueStream s = streams.remove(call.getString("req", ""));
        if (s != null) s.end();
        call.resolve();
    }
}
