package expo.modules.appdatabase

import android.content.Context
import android.database.Cursor
import android.database.DatabaseUtils
import android.database.sqlite.SQLiteCursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteProgram
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.concurrent.Executors

/**
 * The app database (src/database/database.ts) on Android's built-in SQLite. It replaced
 * expo-sqlite, whose bundled SQLite library added about 1 MB to the APK.
 *
 * Android 7–10 ship SQLite versions without UPSERT (`INSERT … ON CONFLICT DO UPDATE`), so the app's
 * SQL avoids it (tests/unit/sqlCompatibility.test.ts guards this).
 */
class AppDatabaseModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("AppDatabase")

    AsyncFunction("openAsync") { name: String, promise: Promise ->
      val ctx = context
      AppDatabase.submit(promise) { AppDatabase.open(ctx, name) }
    }

    AsyncFunction("execAsync") { statements: List<String>, promise: Promise ->
      AppDatabase.submit(promise) { AppDatabase.exec(statements) }
    }

    AsyncFunction("runAsync") { sql: String, params: List<Any?>, promise: Promise ->
      AppDatabase.submit(promise) { AppDatabase.run(sql, params) }
    }

    AsyncFunction("getAllAsync") { sql: String, params: List<Any?>, promise: Promise ->
      AppDatabase.submit(promise) { AppDatabase.query(sql, params) }
    }

    AsyncFunction("beginTransactionAsync") { promise: Promise ->
      AppDatabase.submit(promise) { AppDatabase.begin() }
    }

    AsyncFunction("commitTransactionAsync") { promise: Promise ->
      AppDatabase.submit(promise) { AppDatabase.commit() }
    }

    AsyncFunction("rollbackTransactionAsync") { promise: Promise ->
      AppDatabase.submit(promise) { AppDatabase.rollback() }
    }
  }
}

/**
 * One connection, used from one thread: every call runs on that thread in arrival order. Android
 * ties a transaction to the thread that began it, and JS spreads a transaction over several calls
 * (begin, statements, commit). Queries issued during a transaction run inside it.
 */
internal object AppDatabase {
  private val executor = Executors.newSingleThreadExecutor { runnable -> Thread(runnable, "StrideAppDatabase") }

  // Only touched on the executor thread.
  private var database: SQLiteDatabase? = null

  fun submit(promise: Promise, block: () -> Any?) {
    executor.execute {
      val result = try {
        block()
      } catch (error: Throwable) {
        promise.reject("ERR_DATABASE", error.message ?: error.javaClass.simpleName, error)
        return@execute
      }
      promise.resolve(if (result == Unit) null else result)
    }
  }

  fun open(context: Context, name: String) {
    database?.let { open ->
      // A JS reload (development) can leave a transaction open; the new runtime starts clean.
      while (open.inTransaction()) open.endTransaction()
      return
    }
    // The file expo-sqlite used, so existing data carries over.
    val file = File(File(context.filesDir, "SQLite"), name)
    file.parentFile?.mkdirs()
    val db = SQLiteDatabase.openOrCreateDatabase(file, null)
    // A single connection with a rollback journal and synchronous=FULL: a commit is on disk before
    // the call returns, which the tracking engine relies on before it deletes the native journal.
    // (In WAL mode Android may use synchronous=NORMAL and cannot be told otherwise before API 30.)
    db.disableWriteAheadLogging()
    db.setForeignKeyConstraintsEnabled(true)
    db.execSQL("PRAGMA synchronous = FULL")
    database = db
  }

  fun exec(statements: List<String>) {
    val db = requireOpen()
    for (sql in statements) db.execSQL(sql)
  }

  fun run(sql: String, params: List<Any?>): Map<String, Double> {
    val db = requireOpen()
    val changes = db.compileStatement(sql).use { statement ->
      bind(statement, params)
      statement.executeUpdateDelete()
    }
    // One connection, so this is the row inserted by the statement above (if any).
    val lastInsertRowId = DatabaseUtils.longForQuery(db, "SELECT last_insert_rowid()", null)
    return mapOf("changes" to changes.toDouble(), "lastInsertRowId" to lastInsertRowId.toDouble())
  }

  fun query(sql: String, params: List<Any?>): List<Map<String, Any?>> {
    val db = requireOpen()
    // rawQuery binds every argument as text; the factory binds them with their real types instead.
    val factory = SQLiteDatabase.CursorFactory { _, driver, editTable, query ->
      bind(query, params)
      SQLiteCursor(driver, editTable, query)
    }
    // editTable only matters for the long-deprecated editable cursors.
    return db.rawQueryWithFactory(factory, sql, null, "").use { cursor ->
      val names = cursor.columnNames
      val rows = ArrayList<Map<String, Any?>>()
      while (cursor.moveToNext()) {
        val row = HashMap<String, Any?>(names.size * 2)
        for (index in names.indices) row[names[index]] = valueAt(cursor, index)
        rows.add(row)
      }
      rows
    }
  }

  fun begin() = requireOpen().beginTransaction()

  fun commit() {
    val db = requireOpen()
    db.setTransactionSuccessful()
    db.endTransaction()
  }

  fun rollback() {
    val db = requireOpen()
    if (db.inTransaction()) db.endTransaction()
  }

  private fun requireOpen(): SQLiteDatabase =
    database ?: throw IllegalStateException("The app database is not open.")

  /** JS numbers arrive as doubles; whole numbers are bound as integers, like SQLite literals. */
  private fun bind(program: SQLiteProgram, params: List<Any?>) {
    params.forEachIndexed { position, value ->
      val index = position + 1
      when (value) {
        null -> program.bindNull(index)
        is String -> program.bindString(index, value)
        is Boolean -> program.bindLong(index, if (value) 1L else 0L)
        is Number -> {
          val number = value.toDouble()
          val whole = number % 1.0 == 0.0 && number >= Long.MIN_VALUE.toDouble() && number <= Long.MAX_VALUE.toDouble()
          if (whole) program.bindLong(index, number.toLong()) else program.bindDouble(index, number)
        }
        else -> throw IllegalArgumentException("Unsupported SQL parameter type: ${value.javaClass.simpleName}")
      }
    }
  }

  private fun valueAt(cursor: Cursor, index: Int): Any? =
    when (cursor.getType(index)) {
      Cursor.FIELD_TYPE_INTEGER -> cursor.getLong(index).toDouble()
      Cursor.FIELD_TYPE_FLOAT -> cursor.getDouble(index)
      Cursor.FIELD_TYPE_STRING -> cursor.getString(index)
      // NULL, and BLOBs, which the app never stores.
      else -> null
    }
}
