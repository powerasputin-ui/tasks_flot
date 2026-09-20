import { stringToColor } from "@/components/ui/Avatar";

const NEUTRAL = "#8794a3";

/** Цвет человека: тот же, что у его аватара в таблице и шапке (стабильно по имени); «Система» — серый. */
export function personColor(name: string | null | undefined): string {
  return name ? stringToColor(name) : NEUTRAL;
}

/** Круглый аватар с инициалом в цвете человека. */
export function PersonAvatar({ name, size = 24 }: { name: string | null | undefined; size?: number }) {
  const label = name?.trim() || "Система";
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.44, background: personColor(name) }}
      aria-hidden
    >
      {label.charAt(0).toUpperCase()}
    </span>
  );
}

/** Имя человека его цветом (без полужирного: цвет уже выделяет). */
export function PersonName({ name }: { name: string | null | undefined }) {
  return (
    <span className="font-medium" style={{ color: personColor(name) }}>
      {name?.trim() || "Система"}
    </span>
  );
}
