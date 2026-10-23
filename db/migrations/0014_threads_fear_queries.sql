-- Wider Threads search: people describing fear and panic in their own words, in English and Russian.
-- Replaces the starter list only where it was never edited.
alter table public.threads_settings alter column queries set default array[
  'panic attack', 'anxiety attack', 'I was so scared', 'I froze', 'my heart was racing', 'couldn''t breathe',
  'freaking out', 'didn''t know what to do', 'scared to death',
  'паническая атака', 'панические атаки', 'мне было страшно', 'я испугалась', 'я испугался', 'не знала что делать',
  'не знал что делать', 'сердце колотится', 'не могу успокоиться', 'накрыло тревогой', 'приступ паники'];

update public.threads_settings
   set queries = array[
     'panic attack', 'anxiety attack', 'I was so scared', 'I froze', 'my heart was racing', 'couldn''t breathe',
     'freaking out', 'didn''t know what to do', 'scared to death',
     'паническая атака', 'панические атаки', 'мне было страшно', 'я испугалась', 'я испугался', 'не знала что делать',
     'не знал что делать', 'сердце колотится', 'не могу успокоиться', 'накрыло тревогой', 'приступ паники']
 where queries = array['panic attack', 'anxiety attack', 'паническая атака', 'панические атаки'];
