import org.apache.lucene.index.*;
import org.apache.lucene.search.*;
import org.apache.lucene.store.FSDirectory;
import org.apache.lucene.document.Document;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;

// Extracts concepts of a given module into a compact JSON keyed by conceptId.
// Each value: {a:active, e:effectiveTime, d:display, ld:<languageDescriptions verbatim>}
public class BuildData {
    public static void main(String[] args) throws Exception {
        String indexPath = args[0];
        String module = args.length > 1 ? args[1] : "1601000220105";
        String outPath = args.length > 2 ? args[2] : "data.json";

        DirectoryReader reader = DirectoryReader.open(FSDirectory.open(Paths.get(indexPath)));
        IndexSearcher searcher = new IndexSearcher(reader);

        // Pull every concept doc in the module. prop_moduleId is an indexed term.
        Query q = new TermQuery(new Term("prop_moduleId", module));
        int total = searcher.count(q);
        System.out.println("Concepts in module " + module + ": " + total);

        Writer w = new BufferedWriter(new OutputStreamWriter(
                new FileOutputStream(outPath), StandardCharsets.UTF_8), 1 << 20);
        w.write("{\"version\":\"20260621\",\"module\":\"" + module + "\",\"concepts\":{");

        final boolean[] first = {true};
        final int[] emitted = {0};
        searcher.search(q, new SimpleCollector() {
            LeafReader lr;
            public void doSetNextReader(LeafReaderContext ctx) { lr = ctx.reader(); }
            public ScoreMode scoreMode() { return ScoreMode.COMPLETE_NO_SCORES; }
            public void collect(int doc) throws IOException {
                Document d = lr.document(doc);
                String id = d.get("shortId");
                String ld = d.get("languageDescriptions");
                if (id == null || ld == null) return;
                try {
                    if (!first[0]) w.write(',');
                    first[0] = false;
                    w.write('"'); w.write(id); w.write("\":{\"a\":\"");
                    w.write(nz(d.get("active"))); w.write("\",\"e\":\"");
                    w.write(nz(d.get("prop_effectiveTime"))); w.write("\",\"d\":");
                    w.write(jsonStr(d.get("display"))); w.write(",\"ld\":");
                    w.write(ld); w.write('}');
                    emitted[0]++;
                } catch (IOException e) { throw new UncheckedIOException(e); }
            }
        });

        w.write("}}");
        w.close();
        reader.close();
        System.out.println("Emitted: " + emitted[0] + " -> " + outPath);
    }

    static String nz(String s) { return s == null ? "" : s; }

    static String jsonStr(String s) {
        if (s == null) return "\"\"";
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default: if (c < 0x20) b.append(String.format("\\u%04x", (int) c)); else b.append(c);
            }
        }
        return b.append('"').toString();
    }
}
