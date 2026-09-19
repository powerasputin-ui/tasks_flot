import { ArrowRight, CheckCircle2, ClipboardCheck, Send } from "lucide-react";

// Заглушка под этапы 3-4 ТЗ v4: раскладка экрана готова, данные цикла подключатся позже.
const STAGES = [
  { icon: <Send size={18} />, title: "Сбор", text: "Руководители отмечают позиции «Опер» — они уходят куратору." },
  { icon: <ClipboardCheck size={18} />, title: "Проверка куратором", text: "Куратор просматривает, правит и формирует итоговый набор." },
  { icon: <CheckCircle2 size={18} />, title: "Финал", text: "Итоговый снимок фиксируется и доступен руководству." },
];

export default function OperativkaPage() {
  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      <p className="label-caps">Оперативка</p>
      <h1 className="text-2xl font-semibold leading-8 text-on-surface">Цикл оперативки</h1>
      <p className="mt-1 text-[13px] text-on-surface-variant">
        Экран цикла (кто отправил позиции, счётчики, финальная версия для руководства) появится на следующих этапах разработки.
      </p>

      <div className="mt-6 grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-stretch">
        {STAGES.flatMap((s, i) => [
          <div key={s.title} className="surface p-5">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary-soft text-primary">{s.icon}</span>
            <h2 className="mt-3 text-[14px] font-semibold text-on-surface">{s.title}</h2>
            <p className="mt-1 text-[13px] text-on-surface-variant">{s.text}</p>
            <div className="mt-4 text-[48px] font-bold leading-[1.1] tracking-tight text-outline-variant">—</div>
          </div>,
          i < STAGES.length - 1 ? (
            <div key={`a${i}`} className="hidden items-center text-outline md:flex">
              <ArrowRight size={18} />
            </div>
          ) : null,
        ])}
      </div>
    </div>
  );
}
