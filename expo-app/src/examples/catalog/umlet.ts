import { defineExamples, lines } from '../define';

const umlet = defineExamples([
    {
        diagramType: "umlet",
        default: true,
        description: "Class Diagram",
        title: "UMLet",
        doc: "https://www.umlet.com/",
        language: "xml",
        keywords: ["uml", "class"],
        source: lines([
            "<diagram><zoom_level>10</zoom_level><element><id>UMLClass</id><coordinates><x>260</x><y>90</y><w>210</w><h>190</h></coordinates><panel_attributes>&lt;&lt;Stereotype&gt;&gt;",
            "Package::FatClass",
            "{Some Properties}",
            "--",
            "-id: Long",
            "_-ClassAttribute: Long_",
            "--",
            "#Operation(i: int): int",
            "/+AbstractOperation()/",
            "--",
            "Responsibilities",
            "-- Resp1",
            "*-- Resp2*</panel_attributes><additional_attributes></additional_attributes></element><element><id>UMLClass</id><coordinates><x>260</x><y>340</y><w>210</w><h>70</h></coordinates><panel_attributes>_object: Class_",
            "--",
            "id: Long=\"36548\"",
            "[waiting for message]</panel_attributes><additional_attributes></additional_attributes></element><element><id>Relation</id><coordinates><x>360</x><y>270</y><w>100</w><h>90</h></coordinates><panel_attributes>lt=&lt;.",
            "&lt;&lt;instanceOf&gt;&gt;</panel_attributes><additional_attributes>10;10;10;70</additional_attributes></element><element><id>UMLClass</id><coordinates><x>260</x><y>50</y><w>100</w><h>30</h></coordinates><panel_attributes>SimpleClass</panel_attributes><additional_attributes></additional_attributes></element><element><id>UMLClass</id><coordinates><x>370</x><y>50</y><w>100</w><h>30</h></coordinates><panel_attributes>/AbstractClass/",
            "</panel_attributes><additional_attributes></additional_attributes></element></diagram>",
        ]),
    },
]);

export default umlet;
