import {GENERATORS, YEAR_HOURS} from './Constants'
import {GeneratorDefinition} from './reducers/StateTypes'


/*
General balance notes:
- Small plants should be more expensive / less efficient than medium + large plants of the same type
  (ditto for peaking -> load-following -> baseline)
- To double check my math, could have a function / test that validates
  - Could use Joi to validate basic assumption (like min <= max)
  - Plus more intelligent tests, like that cost gradients hold for given fuel + size vs type and fuel + type vs size
  - baseline most efficient but uncontrollable, load-following middle, peaking least efficient but fastest to change: https://en.wikipedia.org/wiki/Load_following_power_plant
*/

describe('Generators:', () => {
  describe('correct amortized values:', () => {
    GENERATORS.forEach((generator: GeneratorDefinition) => {
      it('id ' + generator.id, () => {
        const totalOutput = generator.whMax * 1000000 * YEAR_HOURS * generator.lifespanYears / 1.5; // Assume 50% capacity at end of life
        const costFixed = (generator.costOperate * 4 * generator.lifespanYears);
        const costVariable = (generator.costMWh * totalOutput);
        const totalCost = generator.costBuild + costFixed + costVariable;
        expect(totalCost / totalOutput).toBeCloseTo(generator.costAmortizedMWh, 0, 'Amortized MWh');
        expect(generator.costBuild / totalCost).toBeCloseTo(generator.costPercentBuild, 2, '% cost from build');
        expect(costFixed / totalCost).toBeCloseTo(generator.costPercentFixed, 2, '% cost from fixed');
        expect(costVariable / totalCost).toBeCloseTo(generator.costPercentVariable, 2, '% cost from variable');
      });
    });
  });
});
