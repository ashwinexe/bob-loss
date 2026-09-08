import {test,expect} from 'bun:test';
import {cleanCaption,captionAt} from '../public/captions.js';
test('turns raw and escaped pause tags into ellipses',()=>{
  expect(cleanCaption('Easy. <break time="1.50s"> Keep going.')).toBe('Easy... Keep going.');
  expect(cleanCaption('Easy &lt;break time=&quot;1s&quot; /&gt; now')).toBe('Easy... now');
});
test('leaves natural punctuation and drops markup',()=>{
  expect(cleanCaption('There we go... A <em>little</em> colour.')).toBe('There we go... A little colour.');
});
test('captions follow the audio clock and clear between phrases',()=>{
  const words=[{text:'Hello',start_s:0,stop_s:.3},{text:'there.',start_s:.3,stop_s:.7}];
  expect(captionAt(words,.4)).toBe('Hello there.');
  expect(captionAt(words,2)).toBe('');
});
