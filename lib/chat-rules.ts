/**
 * Правила личного чата: кто кому может писать. Чистые функции без базы — их же проверяет сервер на каждом сообщении.
 *
 *  - ЗГД пишет первым: любому руководителю, директору, админу и другому ЗГД.
 *  - Директор и админ пишут свободно: директор — своим руководителям, директору своей дирекции, админу и ЗГД; админ — всем.
 *  - Руководитель пишет коллегам своей дирекции, директору и админу; ЗГД — только в ответ на его сообщение
 *    (пока диалог не закрыт ЗГД); к ЗГД по задаче есть «Запрос» в карточке.
 *  - Технический администратор в чате не участвует.
 */
export type ChatPerson = { id: string; role: string; directorateId: string | null; isActive?: boolean };
export type ChatState = { zgdSpoke: boolean; closed: boolean };

const directorial = (role: string) => role === "DIRECTOR" || role === "ADMIN";
const inChat = (role: string) => role === "HEAD" || role === "DIRECTOR" || role === "ADMIN" || role === "EXECUTIVE";

/** Может ли a открыть диалог с b сам (без предварительного сообщения от b). Руководитель → ЗГД — нет (только ответ). */
export function canStartChat(a: ChatPerson, b: ChatPerson): boolean {
  if (a.id === b.id || !inChat(a.role) || !inChat(b.role)) return false;
  if (a.isActive === false || b.isActive === false) return false;
  if (a.role === "EXECUTIVE") return true;
  if (a.role === "ADMIN") return true;
  const sameDirectorate = !!a.directorateId && a.directorateId === b.directorateId;
  if (a.role === "DIRECTOR") return b.role === "EXECUTIVE" || b.role === "ADMIN" || sameDirectorate;
  // руководитель
  return b.role === "ADMIN" || (sameDirectorate && (b.role === "HEAD" || b.role === "DIRECTOR"));
}

/** Может ли actor написать other в диалоге с таким состоянием: начать, ответить, продолжить. */
export function canPostInChat(actor: ChatPerson, other: ChatPerson, state: ChatState): boolean {
  if (actor.id === other.id || !inChat(actor.role) || !inChat(other.role)) return false;
  if (actor.isActive === false || other.isActive === false) return false;
  if (actor.role === "EXECUTIVE") return true;
  if (other.role === "EXECUTIVE") {
    // директор и админ — свободно; руководитель — только пока ЗГД не закрыл диалог после своего сообщения
    return directorial(actor.role) || (actor.role === "HEAD" && state.zgdSpoke && !state.closed);
  }
  return canStartChat(actor, other);
}

/** Пара в нормализованном порядке — одна пара людей = один диалог. */
export function pairOf(x: string, y: string): { userAId: string; userBId: string } {
  return x < y ? { userAId: x, userBId: y } : { userAId: y, userBId: x };
}

/** Почему писать нельзя — подсказка вместо пустого поля ввода. */
export function chatBlockReason(actor: ChatPerson, other: ChatPerson, state: ChatState): string | null {
  if (canPostInChat(actor, other, state)) return null;
  if (actor.isActive === false || other.isActive === false) return "Учётная запись отключена — писать нельзя.";
  if (other.role === "EXECUTIVE" && actor.role === "HEAD") return state.closed ? "ЗГД закрыл диалог. Ответить можно после его нового сообщения; по задаче — «Запрос» в карточке." : "ЗГД пишет первым. По задаче можно отправить «Запрос» из карточки.";
  return "Писать этому человеку нельзя.";
}

export const CHAT_MAX_TEXT = 2000;
/** Сообщения старше этого срока убирает ежедневная уборка (cron). */
export const CHAT_RETENTION_DAYS = 180;

// ---------- группы и чат по задаче

export const GROUP_MAX_MEMBERS = 50;
export const GROUP_MAX_PER_USER = 100;
export const GROUP_TITLE_MAX = 80;
export const CHAT_MAX_ITEMS = 3;
/** Упоминаний в одном сообщении: каждое — уведомление в колокольчик. */
export const CHAT_MAX_MENTIONS = 10;

/**
 * Можно ли adder добавить target в группу (и включить при создании): тех, кому adder и так вправе писать первым.
 * ЗГД и админ могут писать любому, поэтому и добавлять — любых; руководитель — коллег по дирекции и директора, но не ЗГД.
 */
export function canAddToChat(adder: ChatPerson, target: ChatPerson): boolean {
  return canStartChat(adder, target);
}

/** Следующий владелец группы, когда владелец вышел: самый давний из действующих участников; нет таких — null (группу удаляют). */
export function nextOwner(members: Array<{ userId: string; joinedAt: Date | string; isActive?: boolean }>, leavingId: string): string | null {
  const rest = members.filter((m) => m.userId !== leavingId && m.isActive !== false).sort((a, b) => new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime());
  return rest[0]?.userId ?? null;
}

/** Может ли человек открыть/создать чат по задаче: директор и админ дирекции задачи, ответственный руководитель. ЗГД — нет. */
export function canDiscussItem(actor: ChatPerson, item: { directorateId: string | null; responsibleId: string | null }): boolean {
  if (actor.isActive === false) return false;
  if (actor.role === "ADMIN") return true;
  if (actor.role === "DIRECTOR") return !!actor.directorateId && actor.directorateId === item.directorateId;
  if (actor.role === "HEAD") return item.responsibleId === actor.id;
  return false;
}

/** «@Фамилия И.О.» из текста — только имена участников, выбранных в подсказке; остальное текстом остаётся как есть. */
export function mentionsIn(text: string, members: Array<{ id: string; name: string }>): string[] {
  return members.filter((m) => text.includes(`@${m.name}`)).map((m) => m.id);
}
