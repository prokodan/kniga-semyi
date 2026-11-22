// Документ книги (I5) на @react-pdf/renderer: обложка → оглавление → главы RU + KR с цитатой и QR
// на голос → «Слова деда» → последняя страница. Формат A5, колонтитул с названием, номера страниц.
import { Document, Image, Page, Path, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import QRCode from "qrcode";
import type { BookChapter, BookModel } from "./model";
import { paragraphs } from "./model";
import { FONT_KO, FONT_RU } from "./fonts";
import { COLOR, PAGE, TYPE } from "./theme";

/** Номера страниц глав: заполняется на первом проходе, используется в оглавлении на втором. */
export type PageMap = Record<string, number>;

/** Сборщик первого прохода: страница, на которой видна метка главы, и номер каждой страницы. */
export interface PageCollector {
  mark(chapterId: string, pageNumber: number): void;
  page(pageNumber: number, totalPages: number | undefined): void;
}

export interface BookDocumentProps {
  book: BookModel;
  /** Номера страниц для оглавления (второй проход). Пусто — в оглавлении «·». */
  pages?: PageMap;
  /** Первый проход: сюда сообщаются номера страниц глав и общее число страниц. */
  collect?: PageCollector;
}

const s = StyleSheet.create({
  page: {
    backgroundColor: COLOR.paper,
    color: COLOR.ink,
    fontFamily: FONT_RU,
    fontSize: TYPE.body,
    lineHeight: TYPE.leading,
    paddingTop: PAGE.top,
    paddingBottom: PAGE.bottom,
    paddingHorizontal: PAGE.side,
  },
  header: {
    position: "absolute",
    top: 26,
    left: PAGE.side,
    right: PAGE.side,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: TYPE.small,
    color: COLOR.muted,
    letterSpacing: 0.6,
    borderBottomWidth: 0.5,
    borderBottomColor: COLOR.line,
    paddingBottom: 4,
  },
  footer: {
    position: "absolute",
    top: 552, // от верха: с bottom react-pdf 4.x ставит динамический текст за пределы страницы
    left: PAGE.side,
    right: PAGE.side,
    textAlign: "center",
    fontSize: 8.5,
    lineHeight: 1,
    color: COLOR.muted,
  },
  ko: { fontFamily: FONT_KO, fontSize: TYPE.bodyKo, lineHeight: 1.75 },
  kicker: { fontSize: 8, letterSpacing: 1.6, color: COLOR.seal, textTransform: "uppercase" },
  h1: { fontSize: 21, fontWeight: 700, lineHeight: 1.25, marginTop: 6 },
  h1ko: { fontFamily: FONT_KO, fontSize: 13.5, color: COLOR.inkSoft, lineHeight: 1.4, marginTop: 3 },
  rule: { width: 36, height: 1.5, backgroundColor: COLOR.gold, marginVertical: 14 },
  para: { marginBottom: 7, textAlign: "justify" },
  paraKo: { marginBottom: 7 },
});

// ---------------- QR ----------------

/** QR векторно (Path из модулей): чёткий при печати и с проектора, без картинок. */
function QrMark({ text, size }: { text: string; size: number }) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const margin = 2;
  let d = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (qr.modules.get(x, y)) d += `M${x + margin} ${y + margin}h1v1h-1z`;
    }
  }
  const box = n + margin * 2;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${box} ${box}`}>
      <Path d={d} fill={COLOR.ink} />
    </Svg>
  );
}

function VoiceBox({ url, her }: { url: string; her: boolean }) {
  return (
    <View
      wrap={false}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        borderWidth: 0.75,
        borderColor: COLOR.line,
        borderRadius: 6,
        padding: 8,
        marginTop: 4,
        marginBottom: 16,
        backgroundColor: COLOR.paperDeep,
      }}
    >
      <View style={{ backgroundColor: COLOR.paper, padding: 2, borderRadius: 3 }}>
        <QrMark text={url} size={64} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: 700, fontSize: 9.5, lineHeight: 1.35 }}>Послушайте этот рассказ {her ? "её" : "его"} голосом</Text>
        <Text style={{ fontFamily: FONT_KO, fontSize: 8.5, color: COLOR.inkSoft, lineHeight: 1.45 }}>목소리로 직접 들어 보세요</Text>
        <Text style={{ fontSize: 7.5, color: COLOR.muted, lineHeight: 1.4, marginTop: 2 }}>Наведите камеру телефона на код</Text>
      </View>
    </View>
  );
}

// ---------------- части книги ----------------
// Номер страницы внизу: absolute от верха, left/right = полям, lineHeight 1. С bottom/left 0/наследуемым
// lineHeight react-pdf 4.x уводит динамический текст за страницу или в «unsupported number».
// Каждая глава — отдельная <Page>: так fixed-метка узнаёт её первую страницу для оглавления.

function RunningHead({ title }: { title: string }) {
  return (
    <View style={s.header} fixed>
      <Text>{title}</Text>
      <Text style={{ fontFamily: FONT_KO }}>우리 이야기</Text>
    </View>
  );
}

function Folio({ collect }: { collect?: BookDocumentProps["collect"] }) {
  return (
    <Text
      style={s.footer}
      fixed
      render={({ pageNumber, totalPages }) => {
        collect?.page(pageNumber, totalPages);
        return `${pageNumber}`;
      }}
    />
  );
}

function Cover({ book }: { book: BookModel }) {
  const st = book.storyteller;
  const meta = [book.years, st.birth_place].filter(Boolean).join(" · ");
  return (
    <Page size={PAGE.size} style={{ backgroundColor: COLOR.paperDeep, color: COLOR.ink, fontFamily: FONT_RU, padding: 44 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ fontSize: 8.5, letterSpacing: 2, color: COLOR.muted }}>КНИГА СЕМЬИ</Text>
        {/* красная печать-тоджан */}
        <View style={{ width: 34, height: 34, backgroundColor: COLOR.seal, borderRadius: 3, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontFamily: FONT_KO, fontWeight: 700, fontSize: 9.5, color: COLOR.paper, lineHeight: 1.1, textAlign: "center" }}>
            {"우리\n이야기"}
          </Text>
        </View>
      </View>

      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        {book.photo ? (
          <View style={{ padding: 6, backgroundColor: COLOR.paper, borderWidth: 0.75, borderColor: COLOR.line, marginBottom: 26 }}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- Image из react-pdf, не <img> */}
            <Image src={book.photo} style={{ width: 170, height: 210, objectFit: "cover" }} />
          </View>
        ) : (
          <View style={{ width: 54, height: 1.5, backgroundColor: COLOR.gold, marginBottom: 34 }} />
        )}
        <Text style={{ fontSize: 28, fontWeight: 700, textAlign: "center", lineHeight: 1.2 }}>{st.name}</Text>
        {st.name_ko && (
          <Text style={{ fontFamily: FONT_KO, fontSize: 17, color: COLOR.inkSoft, marginTop: 6, textAlign: "center" }}>{st.name_ko}</Text>
        )}
        {meta && <Text style={{ fontSize: 10.5, color: COLOR.muted, marginTop: 10, textAlign: "center" }}>{meta}</Text>}
      </View>

      <View style={{ alignItems: "center", borderTopWidth: 0.75, borderTopColor: COLOR.gold, paddingTop: 14 }}>
        <Text style={{ fontSize: 14, textAlign: "center" }}>{book.title}</Text>
        <Text style={{ fontFamily: FONT_KO, fontSize: 10, color: COLOR.inkSoft, marginTop: 4 }}>우리 가족 이야기</Text>
      </View>
    </Page>
  );
}

function TocLine({ ch, page }: { ch: BookChapter; page: number | undefined }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", marginBottom: 3 }} wrap={false}>
      <View style={{ flex: 1, paddingRight: 8 }}>
        <Text style={{ fontSize: 10, lineHeight: 1.3 }}>{ch.title}</Text>
        {ch.titleKo && <Text style={{ fontFamily: FONT_KO, fontSize: 8, color: COLOR.muted, lineHeight: 1.3 }}>{ch.titleKo}</Text>}
      </View>
      <Text style={{ fontSize: 10, color: COLOR.inkSoft, minWidth: 18, textAlign: "right" }}>{page ?? "·"}</Text>
    </View>
  );
}

function Toc({ book, pages }: { book: BookModel; pages: PageMap }) {
  return (
    <View>
      <Text style={s.kicker}>
        СОДЕРЖАНИЕ <Text style={{ fontFamily: FONT_KO }}>· 차례</Text>
      </Text>
      <View style={s.rule} />
      {book.groups.map((g) => (
        <View key={g.ru} style={{ marginBottom: 7 }}>
          <Text style={{ fontSize: 7.5, letterSpacing: 1.2, color: COLOR.seal, marginBottom: 2, lineHeight: 1.3 }}>
            {g.ru.toUpperCase()} <Text style={{ fontFamily: FONT_KO }}>· {g.ko}</Text>
          </Text>
          {g.chapters.map((ch) => (
            <TocLine key={ch.id} ch={ch} page={pages[ch.id]} />
          ))}
        </View>
      ))}
      {book.legacy.chapters.length > 0 && (
        <View style={{ marginTop: 6, borderTopWidth: 0.5, borderTopColor: COLOR.line, paddingTop: 10 }}>
          <Text style={{ fontSize: 8, letterSpacing: 1.2, color: COLOR.seal, marginBottom: 4 }}>
            {book.legacy.ru.toUpperCase()} <Text style={{ fontFamily: FONT_KO }}>· {book.legacy.ko}</Text>
          </Text>
          {book.legacy.chapters.map((ch) => (
            <TocLine key={ch.id} ch={ch} page={pages[ch.id]} />
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * Невидимая fixed-метка первого прохода: повторяется на каждой странице <Page> главы,
 * минимальный номер = страница начала главы (для оглавления).
 */
function PageMark({ id, collect }: { id: string; collect?: BookDocumentProps["collect"] }) {
  if (!collect) return null;
  return (
    <Text
      fixed
      style={{ position: "absolute", top: 4, left: 4, fontSize: 1, lineHeight: 1, color: COLOR.paper }}
      render={({ pageNumber }) => {
        collect.mark(id, pageNumber);
        return ".";
      }}
    />
  );
}

/** Страница книги с колонтитулом и номером; wrap — содержимое перетекает на следующие страницы. */
function BookPage({ title, collect, children }: { title: string; collect?: BookDocumentProps["collect"]; children: React.ReactNode }) {
  return (
    <Page size={PAGE.size} style={s.page} wrap>
      <RunningHead title={title} />
      {children}
      <Folio collect={collect} />
    </Page>
  );
}

function Chapter({ ch, legacy, title, her, collect }: { ch: BookChapter; legacy: boolean; title: string; her: boolean; collect?: BookDocumentProps["collect"] }) {
  const paraRu = paragraphs(ch.textRu);
  const paraKo = paragraphs(ch.textKo);
  return (
    <BookPage title={title} collect={collect}>
      <PageMark id={ch.id} collect={collect} />
      <View>
        <Text style={s.kicker}>
          {legacy ? "Наказ" : ch.blockRu} <Text style={{ fontFamily: FONT_KO }}>· {legacy ? "당부" : ch.blockKo}</Text>
        </Text>
        <Text style={s.h1}>{ch.title}</Text>
        {ch.titleKo && <Text style={s.h1ko}>{ch.titleKo}</Text>}
        <View style={s.rule} />

        {ch.quote && (
          <View style={{ borderLeftWidth: 2, borderLeftColor: COLOR.seal, paddingLeft: 10, marginBottom: 12 }} wrap={false}>
            <Text style={{ fontStyle: "italic", fontSize: legacy ? 14 : 12.5, lineHeight: 1.45 }}>«{ch.quote}»</Text>
            {ch.quoteKo && (
              <Text style={{ fontFamily: FONT_KO, fontSize: legacy ? 11 : 10, color: COLOR.inkSoft, lineHeight: 1.6, marginTop: 4 }}>
                “{ch.quoteKo}”
              </Text>
            )}
          </View>
        )}

        <VoiceBox url={ch.voiceUrl} her={her} />

        {paraRu.map((p, i) => (
          <Text key={i} style={s.para}>
            {p}
          </Text>
        ))}
      </View>

      {paraKo.length > 0 && (
        <View break>
          <Text style={s.kicker}>
            <Text style={{ fontFamily: FONT_KO }}>{legacy ? "당부" : ch.blockKo}</Text> · по-корейски
          </Text>
          <Text style={{ ...s.h1ko, fontSize: 17, color: COLOR.ink, fontWeight: 700, marginTop: 6 }}>{ch.titleKo ?? ch.title}</Text>
          <View style={s.rule} />
          <View style={s.ko}>
            {paraKo.map((p, i) => (
              <Text key={i} style={s.paraKo}>
                {p}
              </Text>
            ))}
          </View>
        </View>
      )}
    </BookPage>
  );
}

function LegacyDivider({ book }: { book: BookModel }) {
  return (
    <View style={{ alignItems: "center", paddingTop: 120 }}>
      <View style={{ width: 40, height: 40, backgroundColor: COLOR.seal, borderRadius: 3, marginBottom: 22 }} />
      <Text style={{ fontSize: 24, fontWeight: 700, textAlign: "center", lineHeight: 1.3 }}>{book.legacy.ru}</Text>
      <Text style={{ fontFamily: FONT_KO, fontSize: 15, color: COLOR.inkSoft, marginTop: 8, lineHeight: 1.4 }}>{book.legacy.ko}</Text>
      <View style={{ ...s.rule, marginVertical: 18 }} />
      <Text style={{ fontSize: 10.5, color: COLOR.inkSoft, textAlign: "center", maxWidth: 240 }}>
        То, что {book.storyteller.name} просит передать детям и внукам.
      </Text>
    </View>
  );
}

function Colophon({ book }: { book: BookModel }) {
  const date = book.builtAt.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  return (
    <View style={{ paddingTop: 300 }}>
      <View style={s.rule} />
      <Text style={{ fontSize: 9.5, color: COLOR.inkSoft, lineHeight: 1.6 }}>
        Эту книгу {book.elder === "grandmother" ? "рассказала" : "рассказал"} {book.storyteller.name} — своим голосом, для своей семьи. Каждая глава записана на диктофон
        телефона, бережно отредактирована без переписывания и переведена на корейский язык.
      </Text>
      <Text style={{ fontFamily: FONT_KO, fontSize: 8.5, color: COLOR.muted, lineHeight: 1.7, marginTop: 6 }}>
        이 책은 가족을 위해 직접 목소리로 들려준 이야기를 담았습니다.
      </Text>
      <Text style={{ fontSize: 8, color: COLOR.muted, marginTop: 14 }}>
        {book.title} · собрано {date} · «Книга семьи», Алматы
      </Text>
    </View>
  );
}

export function BookDocument({ book, pages = {}, collect }: BookDocumentProps) {
  const regular = book.chapters.filter((c) => c.block !== "legacy");
  const her = book.elder === "grandmother";
  return (
    <Document title={book.title} author={book.storyteller.name} subject="Книга семьи · 우리 이야기" creator="Книга семьи" producer="Книга семьи" language="ru">
      <Cover book={book} />
      <BookPage title={book.title} collect={collect}>
        <Toc book={book} pages={pages} />
      </BookPage>
      {regular.map((ch) => (
        <Chapter key={ch.id} ch={ch} legacy={false} title={book.title} her={her} collect={collect} />
      ))}
      {book.legacy.chapters.length > 0 && (
        <BookPage title={book.title} collect={collect}>
          <LegacyDivider book={book} />
        </BookPage>
      )}
      {book.legacy.chapters.map((ch) => (
        <Chapter key={ch.id} ch={ch} legacy title={book.title} her={her} collect={collect} />
      ))}
      <BookPage title={book.title} collect={collect}>
        <Colophon book={book} />
      </BookPage>
    </Document>
  );
}
