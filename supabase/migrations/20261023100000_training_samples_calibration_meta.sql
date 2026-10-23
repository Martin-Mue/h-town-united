-- Calibration context captured with every camera training sample, written by LiveCamera.tsx at
-- upload time: whether the calibration was automatic or manual and confirmed by the player, the real
-- video size and crop rectangle, and the four D20/D3/D11/D6 points as 0-1 fractions of the saved
-- training image. Lets the cal_1..cal_4 corner classes be trained on exactly the points the app
-- uses, without guessing the crop afterwards. NULL for samples taken before this existed.
ALTER TABLE public.training_samples
  ADD COLUMN calibration_meta JSONB;
