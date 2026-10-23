-- "There is no hurry" is the opposite of false urgency: the Back rule no longer blocks negated phrases.
update public.product_guardrails
   set patterns = jsonb_set(patterns, '{0}', to_jsonb('(?<!\b(?:no|not|never|any|in no)\s+(?:a\s+|in\s+a\s+|need\s+to\s+)?)\b(only today|today only|last chance|act now|hurry|don''?t wait|limited time|ends tonight|only \d+ (left|hours))\b'::text))
 where code = 'backapp.no_false_urgency'
   and patterns ->> 0 = '\b(only today|today only|last chance|act now|hurry|don''?t wait|limited time|ends tonight|only \d+ (left|hours))\b';
