package nz.scuttlebutt.tremolavossbol

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.util.Log
import androidx.webkit.WebViewAssetLoader.PathHandler
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.io.File
import java.util.zip.GZIPInputStream

/**
 * MbTilesPathHandler
 *
 * A WebViewAssetLoader.PathHandler that reads individual vector tiles from a
 * local MBTiles file (SQLite database) at filesDir/map.mbtiles and returns
 * them as WebResourceResponse objects.
 *
 * Registration in MainActivity (one line in the WebViewAssetLoader.Builder):
 *   .addPathHandler("/mbtiles/", MbTilesPathHandler(this))
 *
 * URL pattern expected by the handler:
 *   https://appassets.androidplatform.net/mbtiles/{z}/{x}/{y}.pbf
 *   → path delivered to handle() is "/{z}/{x}/{y}.pbf"
 *
 * MBTiles tile coordinate convention:
 *   MBTiles stores tiles in TMS order (y-axis is flipped relative to XYZ/slippy):
 *     tile_row = (2^zoom_level − 1) − y_xyz
 *   This handler performs the flip automatically.
 *
 * Tile data:
 *   Vector tiles in MBTiles are typically gzip-compressed PBF blobs.
 *   This handler transparently decompresses them; MapLibre GL JS expects
 *   raw (uncompressed) PBF over HTTP in the WebView context.
 */
class MbTilesPathHandler(private val context: Context) : PathHandler {

    companion object {
        private const val TAG      = "MbTilesPathHandler"
        private const val DB_NAME  = "map.mbtiles"
        private const val MIME_PBF = "application/x-protobuf"

        // Gzip magic bytes
        private val GZIP_MAGIC = byteArrayOf(0x1f.toByte(), 0x8b.toByte())
    }

    // Lazy-open the database; null if the file does not exist yet.
    private val db: SQLiteDatabase? by lazy {
        //val f = File(context.filesDir, DB_NAME)
        val documentsDir = android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOCUMENTS)
        val f = File(documentsDir, "SocialMap/$DB_NAME")

        if (!f.exists()) {
            Log.w(TAG, "$DB_NAME not found in filesDir – offline tiles unavailable")
            null
        } else {
            try {
                SQLiteDatabase.openDatabase(
                    f.absolutePath,
                    null,
                    SQLiteDatabase.OPEN_READONLY
                ).also { Log.i(TAG, "Opened $DB_NAME") }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to open $DB_NAME: ${e.message}")
                null
            }
        }
    }

    /**
     * Called by WebViewAssetLoader for every request under /mbtiles/.
     * @param path  The URL path after the "/mbtiles/" prefix, e.g. "14/8681/5773.pbf"
     */
    override fun handle(path: String): WebResourceResponse? {
        // Strip leading slash if present
        val clean = path.trimStart('/')

        // Expected format: "{z}/{x}/{y}.pbf"
        val parts = clean.removeSuffix(".pbf").split("/")
        if (parts.size != 3) {
            Log.w(TAG, "Unexpected tile path: $path")
            return null
        }

        val z: Int
        val x: Int
        val y: Int
        try {
            z = parts[0].toInt()
            x = parts[1].toInt()
            y = parts[2].toInt()
        } catch (e: NumberFormatException) {
            Log.w(TAG, "Non-integer tile coordinates in: $path")
            return null
        }

        // MBTiles uses TMS y-flip
        val tmsY = (1 shl z) - 1 - y

        val database = db ?: return emptyTileResponse()

        return try {
            val cursor = database.rawQuery(
                "SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?",
                arrayOf(z.toString(), x.toString(), tmsY.toString())
            )

            if (!cursor.moveToFirst()) {
                cursor.close()
                // Return empty 204-like response so MapLibre doesn't retry endlessly
                return emptyTileResponse()
            }

            val blob = cursor.getBlob(0)
            cursor.close()

            // Decompress if gzip-encoded (most MBTiles vector tile files are)
            val data = if (isGzipped(blob)) decompress(blob) else blob

            WebResourceResponse(
                MIME_PBF,
                null,   // encoding not needed for binary
                ByteArrayInputStream(data)
            ).apply {
                // Allow MapLibre to cache tiles in memory across requests
                responseHeaders = mapOf(
                    "Access-Control-Allow-Origin" to "*",
                    "Cache-Control"               to "public, max-age=86400"
                )
            }

        } catch (e: Exception) {
            Log.e(TAG, "Error reading tile z=$z x=$x y=$y (tms=$tmsY): ${e.message}")
            null
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private fun isGzipped(data: ByteArray): Boolean =
        data.size >= 2 &&
                data[0] == GZIP_MAGIC[0] &&
                data[1] == GZIP_MAGIC[1]

    private fun decompress(data: ByteArray): ByteArray =
        GZIPInputStream(ByteArrayInputStream(data)).use { it.readBytes() }

    /**
     * A valid but empty response for tiles that don't exist in the MBTiles
     * (e.g. ocean tiles, areas without data at this zoom).
     * Returns an empty PBF body with HTTP 200 so MapLibre moves on quietly.
     */
    private fun emptyTileResponse(): WebResourceResponse =
        WebResourceResponse(
            MIME_PBF,
            null,
            ByteArrayInputStream(ByteArray(0))
        )
}