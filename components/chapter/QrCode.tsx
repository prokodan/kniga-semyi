import { qrSvg, qrSvgFile } from "@/lib/book/qr";

// QR на страницу голоса. SVG с currentColor на светлом фоне; «Скачать для слайда» — чёрно-белый SVG 1024 px.
export async function QrCode({ url, fileName = "qr-golos.svg" }: { url: string; fileName?: string }) {
  const [svg, file] = await Promise.all([qrSvg(url), qrSvgFile(url)]);
  const href = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(file)}`;
  return (
    <section className="flex flex-col items-center gap-4 rounded-card border border-line bg-paper p-6 text-center sm:flex-row sm:text-left">
      <div className="w-44 shrink-0 rounded-card bg-paper p-1 text-ink [&_svg]:block [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="flex flex-col gap-2">
        <p className="font-serif text-2xl leading-tight">Наведите камеру — и услышите голос</p>
        <p className="text-ink-soft" lang="ko">
          카메라를 대면 목소리를 들을 수 있어요
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-x-5 gap-y-1 sm:justify-start">
          <a href={url} className="inline-flex min-h-12 items-center text-seal underline underline-offset-4">
            Открыть страницу голоса
          </a>
          <a href={href} download={fileName} className="inline-flex min-h-12 items-center text-ink-soft underline underline-offset-4">
            Скачать QR для слайда
          </a>
        </div>
      </div>
    </section>
  );
}
