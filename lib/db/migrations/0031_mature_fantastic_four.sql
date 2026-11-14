DELETE FROM "push_feedback" a USING "push_feedback" b WHERE a.action = 'shown' AND b.action = 'shown' AND a.card_key = b.card_key AND a.for_date = b.for_date AND a.id > b.id;
--> statement-breakpoint
CREATE UNIQUE INDEX "push_feedback_shown_uniq" ON "push_feedback" USING btree ("card_key","for_date") WHERE "push_feedback"."action" = 'shown';
