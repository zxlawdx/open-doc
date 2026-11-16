# CSV: schema, nulls and analysis

## Root causes and implementation

The CSV reader correctly delivered raw lexemes, but the table stored them without an inferred schema. The resource bridge then wrote every Arrow column as a string, and SQL previews called `str()` on every result. Pandas loaded an intermediate CSV independently, so its inference could disagree with SQL, the table and published resources. Publication also stringified Arrow scalars.

New native CSV imports stage a bounded preview (500 records, 20 displayed) and validate the complete file before the insertion transaction. Delimiter, encoding, decimal/thousands separator, header row, date format and per-column overrides are configurable. Conversion errors identify the record, physical line, column and value; invalid overrides prevent import instead of coercing values to null. Source fingerprints reject a file changed between validation and insertion.

The SQLite store retains original CSV lexemes and persists a separate schema/options record. Reconstructed values are native numbers, booleans and nulls. ISO dates are inferred only when every non-null value is valid; ambiguous dates require the selected format. Identifier names (CPF/CEP/ID/SKU and related names), leading-zero numbers and precision-sensitive numbers default to text. Mixed columns remain text. Integer columns with missing values use nullable Float64 so a fractional mean can be filled back into the column; complete integer columns use Int64. Boolean and text columns use nullable boolean and string. Null-only columns use string. These are deliberate options, not a claim of matching every default `read_csv()` heuristic.

Typed snapshots use immutable Vela Parquet resources, written in batches of 1,000 rows, instead of a complete JSON dataset or a string-only Arrow table. Python reads those resources with `dtype_backend='numpy_nullable'`; SQL applies the same persisted scalar converters. SQL result previews retain native numbers/booleans/nulls. Publication stores native JSON scalars and a schema derived from Arrow. Undo restores both the original data resource and its import schema. Typed XLSX and Parquet exports retain numbers, booleans, nulls and literal identifiers.

Existing datasets are not retyped on startup. The **Revisar tipos** action stages a preview and requires explicit confirmation; the revision is checked before applying the schema, and undo/redo restores it. An already open isolated Python frame must be reopened explicitly after a schema review. Unsupported nested Arrow data is rejected before table mutation. Legacy three-argument bridge calls retain their old import behavior for compatibility; the native import UI explicitly requests schema inference.

## Validation

Run `python -m pytest tests/regression/test_csv_inference.py -q` for nullable integers, decimals, negatives, booleans, dates, locale/preamble options, identifiers, null-only and mixed columns, invalid overrides, persistence, mean/fillna/groupby/sum/dropna, Arrow publication/undo, schema review conflicts, actual generated Python reader code and typed exports. One additional test exercises persistent Jupyter cells and DuckDB when local IPC is available. The same-version Pandas comparison uses `assert_frame_equal` with the same dtype/date options; no cross-version reference is substituted.

`tools/qa_csv_import.py` drives the actual Qt application: invalid header, manual conversion error, locale/date options, identifier preservation, import confirmation, visible dtype badges, SQL mean and Pandas fillna. Screenshots are in `docs/images/csv-import/`. CI runs this on Windows and Linux. The packaged notebook smoke also compares against the Pandas version installed inside that executable's project environment.

## Measured cost and complexity

Raw results: `docs/benchmarks/csv-schema-linux.json` and `csv-ui-scale-linux.json`. One local Linux run, Pandas 2.2.3; these are reproducible observations, not performance guarantees or Windows measurements.

| Rows | Old untyped import ms | Validated typed import ms | Typed Parquet ms | Typed DataFrame read ms |
| --- | ---: | ---: | ---: | ---: |
| 1,000 | 4.39 | 11.61 | 36.86 | 19.39 |
| 10,000 | 26.2 | 85.97 | 55.9 | 3.69 |
| 100,000 | 266.24 | 833.0 | 540.23 | 17.22 |
| 1,000,000 | 2738.2 | 8544.54 | 5516.89 | 180.68 |

Every scale (1k, 10k, 100k, 1M) matched direct Pandas with identical options. Full-file validation adds CPU/I/O: the typed import is slower than unvalidated raw insertion. Typed resource construction is a separate first-open cost; subsequent DataFrame loading uses the immutable typed resource. This correctness improvement is not reported as an import speedup.

A separate native Qt run imported/rendered 1M two-column records in 3.70 s, kept 50 DOM rows, rendered a distant page in 60.7 ms and recorded 231 UI heartbeat ticks with a maximum 33.5 ms interval. Whole-process Python/Qt RSS reached 243 MB and child RSS 261 MB; these include runtime and warm state, not just ingestion allocations. Six-column backend measurements above and two-column GUI measurements are different workloads and must not be compared as equal input.

For n rows and m columns, full inference and insertion are O(n*m) time and O(m + preview + batch) auxiliary space, excluding persistent storage. Parquet construction is O(n*m) time with bounded 1,000-row batches. A requested editable DataFrame necessarily occupies O(n*m) memory. SQL aggregate scans are O(n), and groupby typically uses O(g) aggregate state for g groups; sorting or DISTINCT may require additional SQLite work/storage. The frontend renders O(page_size*m) cells, not all n records. CSV export intentionally preserves original lexical values; CSV has no embedded dtype schema. Parquet is the typed interchange format. Local Jupyter IPC is restricted in this environment; Windows/Linux CI executes the real kernel and packaged smoke checks.
