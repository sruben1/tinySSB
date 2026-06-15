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
        private const val TAG      = "MbTilesPathHandler"
        private const val BASE_MAP_DB_NAME  = "map.mbtiles"
        private const val MIME_PBF = "application/x-protobuf"

        // Gzip magic bytes
        private val GZIP_MAGIC = byteArrayOf(0x1f.toByte(), 0x8b.toByte())
    }
/*
    // Lazy-open the database; null if the file does not exist yet.
    private val db: SQLiteDatabase? by lazy {

        val f = File(context.filesDir, "SocialMap/$BASE_MAP_DB_NAME")

        if (!f.exists()) {
            if ( true /*TODO check file avail in ASSETS, copy if yes, otherwise give error...*/ ){}
            Log.w(TAG, "$BASE_MAP_DB_NAME not found in filesDir – offline tiles unavailable")
            null
        } else {
            try {
                SQLiteDatabase.openDatabase(
                    f.absolutePath,
                    null,
                    SQLiteDatabase.OPEN_READONLY
                ).also {
                    Log.i(TAG, "Opened $BASE_MAP_DB_NAME")
                    it.execSQL("PRAGMA cache_size = 2000") // (optional optimizations)
                    it.execSQL("PRAGMA temp_store = MEMORY")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to open $BASE_MAP_DB_NAME: ${e.message}")
                null
            }
        }
    }

    private val tileRegex = Regex("""^(\d+)/(\d+)/(\d+)\.pbf$""")
*/
    /**
     * Called by WebViewAssetLoader for every request under /mbtiles/ parent path.
     * @param path The actual query postfix of each request e.g. "14/8066/5777.pbf"
     */
    override fun handle(path: String): WebResourceResponse? {
        /*val match = tileRegex.matchEntire(path.trimStart('/')) ?: return null
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
            null
        }*/
        return null
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

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