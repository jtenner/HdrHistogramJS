/*
 * This is a TypeScript port of the original Java version, which was written by
 * Gil Tene as described in
 * https://github.com/HdrHistogram/HdrHistogram
 * and released to the public domain, as explained at
 * http://creativecommons.org/publicdomain/zero/1.0/
 */

import Int32Histogram from "./Int32Histogram";
import AbstractHistogram, { HistogramConstructor } from "./AbstractHistogram";
import PackedHistogram from "./PackedHistogram";
import Histogram from "./Histogram";

interface HistogramWithId extends Histogram {
  containingInstanceId?: number;
}

/**
 * Records integer values, and provides stable interval {@link Histogram} samples from
 * live recorded data without interrupting or stalling active recording of values. Each interval
 * histogram provided contains all value counts accumulated since the previous interval histogram
 * was taken.
 * <p>
 * This pattern is commonly used in logging interval histogram information while recording is ongoing.
 * <p>
 * {@link Recorder} supports concurrent
 * {@link Recorder#recordValue} or
 * {@link Recorder#recordValueWithExpectedInterval} calls.
 *
 */
class Recorder {
  static idGenerator = 0;
  private activeHistogram: HistogramWithId;
  private inactiveHistogram: HistogramWithId | null | undefined;
  private histogramConstr: HistogramConstructor;

  /**
   * Construct an auto-resizing {@link Recorder} with a lowest discernible value of
   * 1 and an auto-adjusting highestTrackableValue. Can auto-resize up to track values up to Number.MAX_SAFE_INTEGER.
   *
   * @param numberOfSignificantValueDigits Specifies the precision to use. This is the number of significant
   *                                       decimal digits to which the histogram will maintain value resolution
   *                                       and separation. Must be a non-negative integer between 0 and 5.
   * @param packed Specifies whether the recorder will uses a packed internal representation or not.
   * @param clock (for testing purpose) an action that give current time in ms since 1970
   */
  constructor(
    private numberOfSignificantValueDigits = 3,
    private packed = false,
    private clock = () => new Date().getTime()
  ) {
    this.histogramConstr = packed ? PackedHistogram : Int32Histogram;
    this.activeHistogram = new this.histogramConstr(
      1,
      Number.MAX_SAFE_INTEGER,
      numberOfSignificantValueDigits
    );

    Recorder.idGenerator++;
    this.activeHistogram.containingInstanceId = Recorder.idGenerator;
    this.activeHistogram.startTimeStampMsec = clock();
  }

  /**
   * Record a value in the histogram
   *
   * @param value The value to be recorded
   * @throws may throw Error if value is exceeds highestTrackableValue
   */
  recordValue(value: number) {
    this.activeHistogram.recordValue(value);
  }

  /**
   * Record a value in the histogram (adding to the value's current count)
   *
   * @param value The value to be recorded
   * @param count The number of occurrences of this value to record
   * @throws ArrayIndexOutOfBoundsException (may throw) if value is exceeds highestTrackableValue
   */
  recordValueWithCount(value: number, count: number) {
    this.activeHistogram.recordValueWithCount(value, count);
  }

  /**
   * Record a value
   * <p>
   * To compensate for the loss of sampled values when a recorded value is larger than the expected
   * interval between value samples, Histogram will auto-generate an additional series of decreasingly-smaller
   * (down to the expectedIntervalBetweenValueSamples) value records.
   * <p>
   * See related notes {@link AbstractHistogram#recordValueWithExpectedInterval(long, long)}
   * for more explanations about coordinated omission and expected interval correction.
   *      *
   * @param value The value to record
   * @param expectedIntervalBetweenValueSamples If expectedIntervalBetweenValueSamples is larger than 0, add
   *                                           auto-generated value records as appropriate if value is larger
   *                                           than expectedIntervalBetweenValueSamples
   * @throws ArrayIndexOutOfBoundsException (may throw) if value is exceeds highestTrackableValue
   */
  recordValueWithExpectedInterval(
    value: number,
    expectedIntervalBetweenValueSamples: number
  ) {
    this.activeHistogram.recordValueWithExpectedInterval(
      value,
      expectedIntervalBetweenValueSamples
    );
  }

  /**
   * Get an interval histogram, which will include a stable, consistent view of all value counts
   * accumulated since the last interval histogram was taken.
   * <p>
   * {@link Recorder#getIntervalHistogram(Histogram histogramToRecycle)
   * getIntervalHistogram(histogramToRecycle)}
   * accepts a previously returned interval histogram that can be recycled internally to avoid allocation
   * and content copying operations, and is therefore significantly more efficient for repeated use than
   * {@link Recorder#getIntervalHistogram()} and
   * {@link Recorder#getIntervalHistogramInto getIntervalHistogramInto()}. The provided
   * {@code histogramToRecycle} must
   * be either be null or an interval histogram returned by a previous call to
   * {@link Recorder#getIntervalHistogram(Histogram histogramToRecycle)
   * getIntervalHistogram(histogramToRecycle)} or
   * {@link Recorder#getIntervalHistogram()}.
   * <p>
   * NOTE: The caller is responsible for not recycling the same returned interval histogram more than once. If
   * the same interval histogram instance is recycled more than once, behavior is undefined.
   * <p>
   * Calling {@link Recorder#getIntervalHistogram(Histogram histogramToRecycle)
   * getIntervalHistogram(histogramToRecycle)} will reset the value counts, and start accumulating value
   * counts for the next interval
   *
   * @param histogramToRecycle a previously returned interval histogram that may be recycled to avoid allocation and
   *                           copy operations.
   * @return a histogram containing the value counts accumulated since the last interval histogram was taken.
   */
  getIntervalHistogram(
    histogramToRecycle?: AbstractHistogram
  ): AbstractHistogram {
    if (histogramToRecycle) {
      const histogramToRecycleWithId: HistogramWithId = histogramToRecycle;
      if (
        histogramToRecycleWithId.containingInstanceId !==
        this.activeHistogram.containingInstanceId
      ) {
        throw "replacement histogram must have been obtained via a previous getIntervalHistogram() call from this Recorder";
      }
    }

    this.inactiveHistogram = histogramToRecycle;
    this.performIntervalSample();
    const sampledHistogram = this.inactiveHistogram;
    this.inactiveHistogram = null; // Once we expose the sample, we can't reuse it internally until it is recycled
    return sampledHistogram as AbstractHistogram;
  }

  /**
   * Place a copy of the value counts accumulated since accumulated (since the last interval histogram
   * was taken) into {@code targetHistogram}.
   *
   * Calling {@link Recorder#getIntervalHistogramInto getIntervalHistogramInto()} will reset
   * the value counts, and start accumulating value counts for the next interval.
   *
   * @param targetHistogram the histogram into which the interval histogram's data should be copied
   */
  getIntervalHistogramInto(targetHistogram: AbstractHistogram) {
    this.performIntervalSample();
    if (this.inactiveHistogram) {
      targetHistogram.add(this.inactiveHistogram);
      targetHistogram.startTimeStampMsec = this.inactiveHistogram.startTimeStampMsec;
      targetHistogram.endTimeStampMsec = this.inactiveHistogram.endTimeStampMsec;
    }
  }

  /**
   * Reset any value counts accumulated thus far.
   */
  reset() {
    this.activeHistogram.reset();
    this.activeHistogram.startTimeStampMsec = this.clock();
  }

  private performIntervalSample() {
    if (!this.inactiveHistogram) {
      this.inactiveHistogram = new this.histogramConstr(
        1,
        Number.MAX_SAFE_INTEGER,
        this.numberOfSignificantValueDigits
      );
      this.inactiveHistogram.containingInstanceId = this.activeHistogram.containingInstanceId;
    }
    this.inactiveHistogram.reset();
    const tempHistogram = this.activeHistogram;
    this.activeHistogram = this.inactiveHistogram;
    this.inactiveHistogram = tempHistogram;

    const currentTimeInMs = this.clock();
    this.inactiveHistogram.endTimeStampMsec = currentTimeInMs;
    this.activeHistogram.startTimeStampMsec = currentTimeInMs;
  }
}

export default Recorder;
