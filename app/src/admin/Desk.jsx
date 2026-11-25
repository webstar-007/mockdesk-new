import DeskQueue from '../components/DeskQueue.jsx';
import { PageHead } from './ui.jsx';
export default function Desk() {
  return (<><PageHead title="Doubt desk" sub="Questions students ask their teachers from the review page. Good answers can be shared with everyone who reviews that question." /><DeskQueue base="/admin" /></>);
}
