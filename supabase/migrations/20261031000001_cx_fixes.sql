-- Customer app fixes: dish description in Hindi, and no emoji in the standard rewards text.
-- No apostrophes in comments: the Supabase SQL Editor splitter treats them as quotes.

alter table public.menu_items add column if not exists description_hi text not null default '';

-- Standard customer texts (the owner can still write their own)
create or replace function public.portal_defaults() returns jsonb
language sql immutable as $$
    select jsonb_build_object(
        'texts', jsonb_build_object(
            'heading', 'Your rewards',
            'pointsLabel', 'Chai-ching! You have {points} points',
            'progress', 'You''re {left} away from {reward}!',
            'noRewards', 'No rewards yet. Your first one is on its way',
            'pointsAdded', 'Chai-ching! {points} points added',
            'instagram', 'Tag us on Instagram, earn a treat',
            'underReview', 'Under review — up to 2 days',
            'feedbackAsk', 'How was it? Rate each dish',
            'feedbackThanks', 'Thank you! The kitchen reads every rating.',
            'review', 'Loved it? Tell others on Google'),
        'show', jsonb_build_object('points', true, 'progress', true, 'upcoming', true, 'offers', true, 'instagram', true,
                                   'feedback', true, 'review', true,
                                   'rewardBar', true, 'photos', true, 'badges', true, 'infoButtons', true,
                                   'nudgeMilestone', true, 'nudgePoints', true, 'nudgeCelebrate', true));
$$;

