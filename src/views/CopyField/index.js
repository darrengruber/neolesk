import { copyButtonHovered, copyText } from '../../actions/editor'
import { useDispatch, useSelector } from 'react-redux'
import Internal from './CopyField'

const imageFormats = new Set(['svg', 'png', 'jpeg', 'jpg', 'gif', 'webp']);

const CopyField = ({ scope }) => {
    const diagramEditUrl = useSelector((state) => state.editor.diagramEditUrl)
    const diagramUrl = useSelector((state) => state.editor.diagramUrl)
    const filetype = useSelector((state) => state.editor.filetype)
    const diagramText = useSelector((state) => state.editor.diagramText).replaceAll("-->","\\-\\-\\>")
    const isImageFormat = imageFormats.has(filetype)
    const markdownBody = isImageFormat
        ? `![Diagram](${diagramUrl})`
        : `[Diagram ${filetype.toUpperCase()}](${diagramUrl})`
    
    let text = '';
    switch (scope) {
        case 'image': text = diagramUrl; break;
        case 'edit': text = diagramEditUrl; break;
        case 'markdown': text = `${markdownBody}\n\n[Edit this diagram](${diagramEditUrl})\n`; break;
        case 'markdownsource': text = `${markdownBody}\n\n<!--\n${diagramText}\n-->\n\n[Edit this diagram](${diagramEditUrl})\n`; break;
        default:
    }
    const isMultiline = scope === 'markdown' || scope === 'markdownsource';
    const isCopyHover = useSelector((state) => state.editor.scopes[scope]?.isHover)
    const isCopied = useSelector((state) => state.editor.scopes[scope]?.isCopied)
    const dispatch = useDispatch();
    const onCopyHover = (scope, isHover) => dispatch(copyButtonHovered(scope, isHover));
    const onCopy = (scope, text) => dispatch(copyText(scope, text));

    return Internal({ text, scope, isCopyHover, isCopied, isMultiline, onCopyHover, onCopy });
}

export default CopyField;
