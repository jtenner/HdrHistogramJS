import "core-js";
import { build } from ".";
import AbstractHistogram from "./AbstractHistogram";
import { NO_TAG } from "./AbstractHistogramBase";
import Int32Histogram from "./Int32Histogram";
import { initWebAssembly } from "./wasm";

class HistogramForTests extends AbstractHistogram {
  //constructor() {}

  clearCounts() {}

  incrementCountAtIndex(index: number): void {}

  incrementTotalCount(): void {}

  addToTotalCount(value: number) {}

  setTotalCount(totalCount: number) {}

  resize(newHighestTrackableValue: number): void {
    this.establishSize(newHighestTrackableValue);
  }

  addToCountAtIndex(index: number, value: number): void {}

  setCountAtIndex(index: number, value: number): void {}

  getTotalCount() {
    return 0;
  }

  getCountAtIndex(index: number): number {
    return 0;
  }

  protected _getEstimatedFootprintInBytes() {
    return 42;
  }

  copyCorrectedForCoordinatedOmission(
    expectedIntervalBetweenValueSamples: number
  ) {
    return this;
  }
}

describe("Histogram initialization", () => {
  let histogram: AbstractHistogram;
  beforeEach(() => {
    histogram = new HistogramForTests(1, Number.MAX_SAFE_INTEGER, 3);
  });

  it("should set sub bucket size", () => {
    expect(histogram.subBucketCount).toBe(2048);
  });

  it("should set resize to false when max value specified", () => {
    expect(histogram.autoResize).toBe(false);
  });

  it("should compute counts array length", () => {
    expect(histogram.countsArrayLength).toBe(45056);
  });

  it("should compute bucket count", () => {
    expect(histogram.bucketCount).toBe(43);
  });

  it("should set min non zero value", () => {
    expect(histogram.minNonZeroValue).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("should set max value", () => {
    expect(histogram.maxValue).toBe(0);
  });
});

describe("Histogram recording values", () => {
  it("should compute count index when value in first bucket", () => {
    // given
    const histogram = new HistogramForTests(1, Number.MAX_SAFE_INTEGER, 3);
    // when
    const index = histogram.countsArrayIndex(2000); // 2000 < 2048
    expect(index).toBe(2000);
  });

  it("should compute count index when value outside first bucket", () => {
    // given
    const histogram = new HistogramForTests(1, Number.MAX_SAFE_INTEGER, 3);
    // when
    const index = histogram.countsArrayIndex(2050); // 2050 > 2048
    // then
    expect(index).toBe(2049);
  });

  it("should compute count index taking into account lowest discernible value", () => {
    // given
    const histogram = new HistogramForTests(2000, Number.MAX_SAFE_INTEGER, 2);
    // when
    const index = histogram.countsArrayIndex(16000);
    // then
    expect(index).toBe(15);
  });

  it("should compute count index of a big value taking into account lowest discernible value", () => {
    // given
    const histogram = new HistogramForTests(2000, Number.MAX_SAFE_INTEGER, 2);
    // when
    const bigValue = Number.MAX_SAFE_INTEGER - 1;
    const index = histogram.countsArrayIndex(bigValue);
    // then
    expect(index).toBe(4735);
  });

  it("should update min non zero value", () => {
    // given
    const histogram = new HistogramForTests(1, Number.MAX_SAFE_INTEGER, 3);
    // when
    histogram.recordValue(123);
    // then
    expect(histogram.minNonZeroValue).toBe(123);
  });

  it("should update max value", () => {
    // given
    const histogram = new HistogramForTests(1, Number.MAX_SAFE_INTEGER, 3);
    // when
    histogram.recordValue(123);
    // then
    expect(histogram.maxValue).toBe(123);
  });

  it("should throw an error when value bigger than highest trackable value", () => {
    // given
    const histogram = new HistogramForTests(1, 4096, 3);
    // when then
    expect(() => histogram.recordValue(9000)).toThrowError();
  });

  it("should not throw an error when autoresize enable and value bigger than highest trackable value", () => {
    // given
    const histogram = new HistogramForTests(1, 4096, 3);
    histogram.autoResize = true;
    // when then
    expect(() => histogram.recordValue(9000)).not.toThrowError();
  });

  it("should increase counts array size when recording value bigger than highest trackable value", () => {
    // given
    const histogram = new HistogramForTests(1, 4096, 3);
    histogram.autoResize = true;
    // when
    histogram.recordValue(9000);
    // then
    expect(histogram.highestTrackableValue).toBeGreaterThan(9000);
  });

  /*
  it("should bench", () => {
    const histogram = new HistogramForTests(1, Number.MAX_SAFE_INTEGER, 3);
    for (var i = 0; i < 1000; i++) {
       histogram.recordValue(Math.floor(Math.random() * 100000));
    }
    const start = new Date().getTime();
    const nbLoop = 100000;
    for (var i = 0; i < nbLoop; i++) {
       histogram.recordValue(Math.floor(Math.random() * 100000));
    }
    const end = new Date().getTime();
    console.log("avg", (end - start)/nbLoop );

  }) 
*/
});

describe("Histogram computing statistics", () => {
  const histogram = new Int32Histogram(1, Number.MAX_SAFE_INTEGER, 3);

  it("should compute mean value", () => {
    // given
    histogram.reset();
    // when
    histogram.recordValue(25);
    histogram.recordValue(50);
    histogram.recordValue(75);
    // then
    expect(histogram.getMean()).toBe(50);
  });

  it("should compute standard deviation", () => {
    // given
    histogram.reset();
    // when
    histogram.recordValue(25);
    histogram.recordValue(50);
    histogram.recordValue(75);
    // then
    expect(histogram.getStdDeviation()).toBeGreaterThan(20.4124);
    expect(histogram.getStdDeviation()).toBeLessThan(20.4125);
  });

  it("should compute percentile distribution", () => {
    // given
    histogram.reset();
    // when
    histogram.recordValue(25);
    histogram.recordValue(50);
    histogram.recordValue(75);
    // then
    const expectedResult = `       Value     Percentile TotalCount 1/(1-Percentile)

      25.000 0.000000000000          1           1.00
      25.000 0.100000000000          1           1.11
      25.000 0.200000000000          1           1.25
      25.000 0.300000000000          1           1.43
      50.000 0.400000000000          2           1.67
      50.000 0.500000000000          2           2.00
      50.000 0.550000000000          2           2.22
      50.000 0.600000000000          2           2.50
      50.000 0.650000000000          2           2.86
      75.000 0.700000000000          3           3.33
      75.000 1.000000000000          3
#[Mean    =       50.000, StdDeviation   =       20.412]
#[Max     =       75.000, Total count    =            3]
#[Buckets =           43, SubBuckets     =         2048]
`;
    expect(histogram.outputPercentileDistribution()).toBe(expectedResult);
  });

  it("should compute percentile distribution in csv format", () => {
    // given
    histogram.reset();
    // when
    histogram.recordValue(25);
    histogram.recordValue(50);
    histogram.recordValue(75);
    // then
    const expectedResult = `"Value","Percentile","TotalCount","1/(1-Percentile)"
25.000,0.000000000000,1,1.00
25.000,0.100000000000,1,1.11
25.000,0.200000000000,1,1.25
25.000,0.300000000000,1,1.43
50.000,0.400000000000,2,1.67
50.000,0.500000000000,2,2.00
50.000,0.550000000000,2,2.22
50.000,0.600000000000,2,2.50
50.000,0.650000000000,2,2.86
75.000,0.700000000000,3,3.33
75.000,1.000000000000,3,Infinity
`;
    expect(
      histogram.outputPercentileDistribution(undefined, undefined, true)
    ).toBe(expectedResult);
  });
});

describe("Histogram correcting coordinated omissions", () => {
  const histogram = new Int32Histogram(1, Number.MAX_SAFE_INTEGER, 3);

  it("should generate additional values when recording", () => {
    // given
    histogram.reset();
    // when
    histogram.recordValueWithExpectedInterval(207, 100);
    // then
    expect(histogram.totalCount).toBe(2);
    expect(histogram.minNonZeroValue).toBe(107);
    expect(histogram.maxValue).toBe(207);
  });

  it("should generate additional values when correcting after recording", () => {
    // given
    histogram.reset();
    histogram.recordValue(207);
    histogram.recordValue(207);
    // when
    const correctedHistogram = histogram.copyCorrectedForCoordinatedOmission(
      100
    );
    // then
    expect(correctedHistogram.totalCount).toBe(4);
    expect(correctedHistogram.minNonZeroValue).toBe(107);
    expect(correctedHistogram.maxValue).toBe(207);
  });

  it("should generate additional values when correcting after recording bis", () => {
    // given
    histogram.reset();
    histogram.recordValue(207);
    histogram.recordValue(207);
    // when
    const correctedHistogram = histogram.copyCorrectedForCoordinatedOmission(
      1000
    );
    // then
    expect(correctedHistogram.totalCount).toBe(2);
    expect(correctedHistogram.minNonZeroValue).toBe(207);
    expect(correctedHistogram.maxValue).toBe(207);
  });
});

describe("Histogram add & substract", () => {
  beforeAll(initWebAssembly);

  it("should add histograms of same size", () => {
    // given
    const histogram = new Int32Histogram(1, Number.MAX_SAFE_INTEGER, 2);
    const histogram2 = new Int32Histogram(1, Number.MAX_SAFE_INTEGER, 2);
    histogram.recordValue(42);
    histogram2.recordValue(158);
    // when
    histogram.add(histogram2);
    // then
    expect(histogram.totalCount).toBe(2);
    expect(histogram.getMean()).toBe(100);
  });

  it("should add histograms of different sizes & precisions", () => {
    // given
    const histogram = build({
      lowestDiscernibleValue: 1,
      highestTrackableValue: 1024,
      autoResize: true,
      numberOfSignificantValueDigits: 2,
      bitBucketSize: 32,
      useWebAssembly: true,
    });
    const histogram2 = build({
      lowestDiscernibleValue: 1,
      highestTrackableValue: 1024,
      autoResize: true,
      numberOfSignificantValueDigits: 3,
      bitBucketSize: 32,
      useWebAssembly: true,
    });
    //histogram2.autoResize = true;
    histogram.recordValue(42000);
    histogram2.recordValue(1000);
    // when
    histogram.add(histogram2);
    // then
    expect(histogram.totalCount).toBe(2);
    expect(Math.floor(histogram.mean / 100)).toBe(215);
  });

  it("should add histograms of different sizes", () => {
    // given
    const histogram = new Int32Histogram(1, Number.MAX_SAFE_INTEGER, 2);
    const histogram2 = new Int32Histogram(1, 1024, 2);
    histogram2.autoResize = true;
    histogram.recordValue(42000);
    histogram2.recordValue(1000);
    // when
    histogram.add(histogram2);
    // then
    expect(histogram.totalCount).toBe(2);
    expect(Math.floor(histogram.getMean() / 100)).toBe(215);
  });
  it("should add histograms of different sizes b", () => {
    // given
    const histogram = new Int32Histogram(1, Number.MAX_SAFE_INTEGER, 2);
    const histogram2 = new Int32Histogram(1, 1024, 2);
    histogram2.autoResize = true;
    histogram.recordValue(42000);
    histogram2.recordValue(1000);
    // when
    histogram.add(histogram2);
    // then
    expect(histogram.totalCount).toBe(2);
    expect(Math.floor(histogram.getMean() / 100)).toBe(215);
  });

  it("should be equal when another histogram is added then subtracted", () => {
    // given
    const histogram = new Int32Histogram(1, 1024, 5);
    const histogram2 = new Int32Histogram(1, Number.MAX_SAFE_INTEGER, 5);
    histogram.autoResize = true;
    histogram.recordValue(1000);
    histogram2.recordValue(42000);
    const outputBefore = histogram.outputPercentileDistribution();
    // when
    histogram.add(histogram2);
    histogram.subtract(histogram2);
    // then
    expect(histogram.outputPercentileDistribution()).toBe(outputBefore);
  });
  /*it("should be equal when another histogram is added then subtracted", () => {
    // given
    const histogram = build({ lowestDiscernibleValue: 1, highestTrackableValue: 1024, numberOfSignificantValueDigits: 5, webAssembly: true });
    const histogram2 = build({ lowestDiscernibleValue: 1, highestTrackableValue: Number.MAX_SAFE_INTEGER, numberOfSignificantValueDigits: 5, webAssembly: true });
    histogram.autoResize = true;
    histogram.recordValue(1000);
    histogram2.recordValue(42000);
    const outputBefore = histogram.outputPercentileDistribution();
    // when
    histogram.add(histogram2);
    histogram.subtract(histogram2);
    // then
    expect(histogram.outputPercentileDistribution()).to.be.equal(outputBefore);
  });*/

  it("should be equal when another wasm histogram is added then subtracted", () => {
    // given
    const histogram = build({
      lowestDiscernibleValue: 1,
      highestTrackableValue: 1024,
      autoResize: true,
      numberOfSignificantValueDigits: 5,
      bitBucketSize: 32,
      useWebAssembly: true,
    });
    const histogram2 = build({
      lowestDiscernibleValue: 1,
      highestTrackableValue: Number.MAX_SAFE_INTEGER,
      numberOfSignificantValueDigits: 5,
      bitBucketSize: 32,
      useWebAssembly: true,
    });
    histogram.recordValue(1000);
    histogram2.recordValue(42000);
    const outputBefore = histogram.outputPercentileDistribution();
    // when
    histogram.add(histogram2);
    histogram.subtract(histogram2);
    // then
    expect(histogram.outputPercentileDistribution()).toBe(outputBefore);
  });

  it("should be equal when another histogram is added then subtracted with same characteristics", () => {
    // given
    const histogram = new Int32Histogram(1, Number.MAX_SAFE_INTEGER, 3);
    const histogram2 = new Int32Histogram(1, Number.MAX_SAFE_INTEGER, 3);
    histogram.autoResize = true;
    histogram.recordValue(1000);
    histogram2.recordValue(42000);
    const outputBefore = histogram.outputPercentileDistribution();
    // when
    histogram.add(histogram2);
    histogram.subtract(histogram2);
    // then
    expect(histogram.outputPercentileDistribution()).toBe(outputBefore);
  });
});

describe("Histogram clearing support", () => {
  beforeAll(initWebAssembly);

  it("should reset data in order to reuse histogram", () => {
    // given
    //const histogram = new Int32Histogram(1, Number.MAX_SAFE_INTEGER, 5);
    const histogram = build({
      lowestDiscernibleValue: 1,
      highestTrackableValue: Number.MAX_SAFE_INTEGER,
      numberOfSignificantValueDigits: 5,
      useWebAssembly: true,
    }); // new Int32Histogram(1, Number.MAX_SAFE_INTEGER, 5);
    histogram.startTimeStampMsec = 42;
    histogram.endTimeStampMsec = 56;
    histogram.tag = "blabla";
    histogram.recordValue(1000);
    // when
    histogram.reset();
    // then
    expect(histogram.totalCount).toBe(0);
    expect(histogram.startTimeStampMsec).toBe(0);
    expect(histogram.endTimeStampMsec).toBe(0);
    expect(histogram.tag).toBe(NO_TAG);
    expect(histogram.maxValue).toBe(0);
    expect(histogram.minNonZeroValue).toBeGreaterThan(Number.MAX_SAFE_INTEGER);
    expect(histogram.getValueAtPercentile(99.999)).toBe(0);
    //expect(histogram.getValueAtPercentile(9)).to.be.equal(0);
  });
});
