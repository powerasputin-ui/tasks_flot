import { prisma } from "@/lib/prisma";
import { normalizeTerms, termsKey, type Terms } from "@/lib/terms";

/** Как дирекция называет разделы таблицы («Сегмент» → «Проект», «Трек» → «Судно») — для выгрузок, справки и напоминаний. */
export async function loadTerms(directorateId: string): Promise<Terms> {
  const setting = await prisma.appSetting.findUnique({ where: { key: termsKey(directorateId) } });
  return normalizeTerms(setting?.value);
}
