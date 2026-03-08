import { useDispatch, useSelector } from 'react-redux';
import { filetypeChanged } from '../../actions/editor';
import Internal from './OutputFormat';

const OutputFormat = () => {
    const dispatch = useDispatch();
    const filetype = useSelector((state) => state.editor.filetype);
    const diagramType = useSelector((state) => state.editor.diagramType);
    const filetypes = useSelector((state) => state.editor.diagramTypes[diagramType]?.filetypes || ['svg']);
    const onFiletypeChanged = (nextFiletype) => dispatch(filetypeChanged(nextFiletype));
    return <Internal {...{ filetype, filetypes, onFiletypeChanged }} />;
};

export default OutputFormat;
