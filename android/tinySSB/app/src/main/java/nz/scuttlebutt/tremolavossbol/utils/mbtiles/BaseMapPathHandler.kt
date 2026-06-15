package nz.scuttlebutt.tremolavossbol.utils.mbtiles

import android.content.Context
import androidx.webkit.WebViewAssetLoader.PathHandler
import android.database.sqlite.SQLiteDatabase
import android.util.Log
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.io.File
import java.util.zip.GZIPInputStream

class BaseMapPathHandler(private val context: Context) : PathHandler {

    companion object {
        private const val TAG      = "BaseMapPathHandler"; // Just for logging
        private const val MIME_PBF = "application/x-protobuf";
        private const val LOCAL_FILES_BASE_DB_PATH   = "SocialMap/baseMap.mbtiles";
        private const val BUNDLED_BASE_MAP_DB = "web/prod/map/baseMap.mbtiles";

        // Gzip magic bytes:
        private val GZIP_MAGIC = byteArrayOf(0x1f.toByte(), 0x8b.toByte());
        // Valid tile query pattern:
        private val tileRegex = Regex("""^(\d+)/(\d+)/(\d+)\.pbf$""")
    }



    // Lazy-open the database; null if the file does not exist yet.
    private val db: SQLiteDatabase? by lazy {

        val appScopeDbFile = File(context.filesDir, LOCAL_FILES_BASE_DB_PATH);

        // Copy from bundled assets file logic
        if (!appScopeDbFile.exists()) {
            appScopeDbFile.parentFile?.mkdirs();
            Log.i(TAG, "Copying base map from apk (assets/$BUNDLED_BASE_MAP_DB).");

            try {
                context.assets.open(BUNDLED_BASE_MAP_DB).use { input ->
                    appScopeDbFile.outputStream().use { output ->
                        input.copyTo(output, bufferSize = 64 * 1024);
                    }
                }
                Log.i(TAG, "Base map copied (${appScopeDbFile.length()} bytes)")
            } catch (e: Exception) {
                appScopeDbFile.delete()   // remove partial write; next launch will retry
                Log.e(TAG, "Failed to copy base map: ${e.message}")
            }
        }

        // Copy logic
        try {
            SQLiteDatabase.openDatabase(
                appScopeDbFile.absolutePath,
                null,
                SQLiteDatabase.OPEN_READONLY
            ).also {
                Log.i(TAG, "Opened $LOCAL_FILES_BASE_DB_PATH")
                it.execSQL("PRAGMA cache_size = 2000") // (optional optimizations)
                it.execSQL("PRAGMA temp_store = MEMORY")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to open $LOCAL_FILES_BASE_DB_PATH: ${e.message}")
            null
        }
    }

    /**
     * Called by WebViewAssetLoader for every request under /mbtiles/ parent path.
     * @param path The actual query postfix of each request e.g. "14/8066/5777.pbf"
     */
    override fun handle(path: String): WebResourceResponse? {
        val match = tileRegex.matchEntire(path.trimStart('/')) ?: return null
        val (z, x, yXyz) = match.destructured.toList().map { it.toInt() }

        // Important: Convert to TMS (flipped y) as used by MBtiles (MapLibre uses XYZ)
        val yTms = (1 shl z) - 1 - yXyz

        val database = db ?: return emptyTileResponse()

        return try {
            database.rawQuery(
                "SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?",
                arrayOf(z.toString(), x.toString(), yTms.toString())
            ).use { cursor ->
                if (!cursor.moveToFirst()) return emptyTileResponse()

                val blob = cursor.getBlob(0)
                val data = if (isGzipped(blob)) decompress(blob) else blob

                WebResourceResponse(MIME_PBF, null, ByteArrayInputStream(data)).apply {
                    responseHeaders = mapOf(
                        "Access-Control-Allow-Origin" to "*",
                        "Cache-Control" to "public, max-age=86400"
                    )
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error reading tile z=$z x=$x y=$yXyz (tms=$yTms): ${e.message}")
            return null
        }
    }


    //==========
    // Utilities
    //==========
    private fun isGzipped(data: ByteArray): Boolean =
        data.size >= 2 &&
                data[0] == GZIP_MAGIC[0] &&
                data[1] == GZIP_MAGIC[1]

    private fun decompress(data: ByteArray): ByteArray =
        GZIPInputStream(ByteArrayInputStream(data)).use { it.readBytes() }

    private fun emptyTileResponse(): WebResourceResponse =
        WebResourceResponse(
            "text/plain",
            "utf-8",
            404,
            "Not Found",
            mutableMapOf("Access-Control-Allow-Origin" to "*"),
            null
        )

}