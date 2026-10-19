/**
 * Playbook v1: operational rules distilled from the course methodology (our wording, not course text).
 * Each rule carries short phrases used to locate its citation in the imported sources. Rules start as
 * "proposed"; the owner approves them. Product guardrails always override the playbook.
 */
export interface PlaybookSeedRule {
  code: string;
  kind: "principle" | "checklist_item" | "creative_formula" | "review_rule" | "anti_pattern";
  area: "data_flywheel" | "ajtbd" | "content" | "creative" | "distribution" | "attribution" | "analytics" | "onboarding" | "ethics";
  title: string;
  statement: string;
  cite: string[];
}

export const PLAYBOOK_SEED: PlaybookSeedRule[] = [
  { code: "flywheel.outcomes_change_decisions", kind: "principle", area: "data_flywheel", title: "Outcomes must change the next decision", statement: "Every published item is an experiment. If results of past items do not change what we make next, the system is an archive, not a flywheel.", cite: ["не меняют следующие решения", "не является Data Flywheel"] },
  { code: "flywheel.record_the_outcome", kind: "checklist_item", area: "data_flywheel", title: "Record what was known, done, shown and what happened", statement: "For each item keep: what was known before, the decision, the exact version shown, the reaction and the outcome with its date. Without the outcome it is only a log of actions.", cite: ["архив действий", "Что записывать по каждому случаю"] },
  { code: "flywheel.preregister_metrics", kind: "checklist_item", area: "analytics", title: "Choose metrics before publishing", statement: "Set the primary metric, a counter-metric, the measurement window and the minimum sample before an item goes out, not after seeing results.", cite: ["Метрики определяют", "Правила проверочных метрик"] },
  { code: "flywheel.no_backfill", kind: "review_rule", area: "data_flywheel", title: "Do not back-fill decision context", statement: "Only what the system knew at decision time counts as the experiment's context; later knowledge is a new event.", cite: ["что система действительно знала в момент решения"] },
  { code: "flywheel.more_of_the_same_trap", kind: "anti_pattern", area: "data_flywheel", title: "Avoid 'clicked, so show more of the same'", statement: "Keep exploring untested combinations; optimising only on what already won narrows what the system can learn.", cite: ["показываем больше такого же", "больше похожего"] },
  { code: "evidence.ai_inference_is_hypothesis", kind: "principle", area: "ethics", title: "AI inference is a hypothesis, never a fact", statement: "Statements inferred by AI are labelled hypotheses with source, date and confidence; they can be corrected and are never shown as customer facts.", cite: ["Нельзя хранить AI-вывод как установленный факт"] },
  { code: "evidence.attribution_not_causation", kind: "principle", area: "attribution", title: "Attribution shows association, not cause", statement: "A link between a creative and a purchase is not proof that the creative caused it. Only comparable, pre-registered tests can confirm a result.", cite: ["не доказывает причинность"] },
  { code: "ajtbd.two_stamps", kind: "review_rule", area: "ajtbd", title: "Quote or hypothesis, nothing in between", statement: "A statement is either a verbatim quote with its source or a hypothesis. When in doubt, it is a hypothesis.", cite: ["Два штампа", "Сомневаешься"] },
  { code: "ajtbd.model_does_not_count", kind: "review_rule", area: "analytics", title: "The model does not count", statement: "Percentages, shares and totals come from code with a table reference. If there is no computed number, say 'no data'.", cite: ["Модель не считает"] },
  { code: "ajtbd.small_n", kind: "review_rule", area: "analytics", title: "Small samples are labelled", statement: "Cells with fewer than 20 cases are marked 'not enough data' and show no percentages.", cite: ["мало данных"] },
  { code: "ajtbd.criteria_order_defines_segment", kind: "principle", area: "ajtbd", title: "Criteria order defines a segment", statement: "A segment is a Core Job plus success criteria in priority order. The same criteria in another order is another segment; demographics alone never define one.", cite: ["Порядок критериев важнее их списка", "Сегмент = похожие Core Jobs"] },
  { code: "ajtbd.fear_vs_barrier", kind: "principle", area: "ajtbd", title: "Fear is not a barrier", statement: "A fear is a prediction and can be addressed with proof. A barrier is a fact and only changing reality removes it; never try to 'message away' a barrier.", cite: ["Страх ≠ барьер", "Страх это предсказание"] },
  { code: "ajtbd.past_investment", kind: "checklist_item", area: "ajtbd", title: "Past spend, not intentions", statement: "Jobs without evidence of money, time or energy already spent are Fake Jobs: they do not form segments.", cite: ["Прошлые траты, не намерения"] },
  { code: "ajtbd.stable_segment_ids", kind: "review_rule", area: "ajtbd", title: "Segment ids never change silently", statement: "Any change to a segment definition is a new codebook version with a migration map, approved by a human.", cite: ["не меняется молча"] },
  { code: "content.provenance_per_line", kind: "checklist_item", area: "content", title: "Every message line has provenance", statement: "Each hook or message line names its origin: criterion, quote or fear, so it can be traced and tested.", cite: ["провенанс"] },
  { code: "creative.tag_parameters", kind: "checklist_item", area: "creative", title: "Tag every creative by its parameters", statement: "Tag persona, hook, angle, format and CTA on every creative so winning combinations can be found instead of retold.", cite: ["Creo Lab"] },
  { code: "creative.research_before_ads", kind: "principle", area: "creative", title: "Talk to customers before scaling ads", statement: "Customer interviews come before performance spend; their verbatim words feed hooks and scripts.", cite: ["Касдев идёт раньше рекламы", "Касдев до перформанса"] },
  { code: "creative.competitor_proxy_only", kind: "review_rule", area: "creative", title: "Competitor signals are proxies", statement: "For competitor ads, days active and number of variants are proxies only; never present them as measured effectiveness.", cite: ["бюджетов не будет никогда"] },
  { code: "ethics.manipulation_line", kind: "anti_pattern", area: "ethics", title: "Know where persuasion becomes manipulation", statement: "No fake scarcity or countdowns, no fake social proof, no invented old prices, no threats of loss. Honest framing only.", cite: ["Где начинается манипуляция"] },
  { code: "distribution.human_owns_irreversible", kind: "principle", area: "distribution", title: "The irreversible step stays with a human", statement: "Generation can be fast; publishing, replying and spending stay with the owner, who approves the exact version.", cite: ["необратимое действие", "Человек в контуре"] },
  { code: "distribution.gates", kind: "review_rule", area: "distribution", title: "Gates for agents", statement: "Some actions are never automated, whatever the instruction: posting on its own, contacting people repeatedly, acting as someone else.", cite: ["Гейты запрещают агенту"] },
];
