import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/models/dynamic_form_field.dart';
import 'package:mobile_app/widgets/dynamic_form_field_widget.dart';

DynamicFormField _field({
  required DynamicFieldType type,
  List<String> options = const [],
  bool required = true,
}) {
  return DynamicFormField(
    id: 'f1',
    key: 'f1',
    label: 'My Field',
    type: type,
    required: required,
    options: options,
    sortOrder: 0,
  );
}

Widget _wrap(Widget child) => MaterialApp(home: Scaffold(body: child));

void main() {
  testWidgets('text field renders a labeled TextFormField and reports changes', (tester) async {
    dynamic changedValue;
    await tester.pumpWidget(
      _wrap(
        DynamicFormFieldWidget(
          field: _field(type: DynamicFieldType.text),
          value: null,
          errorText: null,
          onChanged: (v) => changedValue = v,
        ),
      ),
    );

    expect(find.text('My Field *'), findsOneWidget);
    await tester.enterText(find.byType(TextFormField), 'hello');
    expect(changedValue, 'hello');
  });

  testWidgets('an error message is shown when errorText is set', (tester) async {
    await tester.pumpWidget(
      _wrap(
        DynamicFormFieldWidget(
          field: _field(type: DynamicFieldType.text),
          value: null,
          errorText: 'My Field is required.',
          onChanged: (_) {},
        ),
      ),
    );

    expect(find.text('My Field is required.'), findsOneWidget);
  });

  testWidgets('dropdown field renders options and reports selection', (tester) async {
    dynamic changedValue;
    await tester.pumpWidget(
      _wrap(
        DynamicFormFieldWidget(
          field: _field(type: DynamicFieldType.dropdown, options: ['A', 'B']),
          value: '',
          errorText: null,
          onChanged: (v) => changedValue = v,
        ),
      ),
    );

    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('B').last);
    await tester.pumpAndSettle();

    expect(changedValue, 'B');
  });

  testWidgets('radio field renders one RadioListTile per option', (tester) async {
    await tester.pumpWidget(
      _wrap(
        DynamicFormFieldWidget(
          field: _field(type: DynamicFieldType.radio, options: ['Email', 'Phone']),
          value: null,
          errorText: null,
          onChanged: (_) {},
        ),
      ),
    );

    expect(find.widgetWithText(RadioListTile<String>, 'Email'), findsOneWidget);
    expect(find.widgetWithText(RadioListTile<String>, 'Phone'), findsOneWidget);
  });

  testWidgets('checkbox field toggles and reports a bool', (tester) async {
    dynamic changedValue;
    await tester.pumpWidget(
      _wrap(
        DynamicFormFieldWidget(
          field: _field(type: DynamicFieldType.checkbox, required: false),
          value: false,
          errorText: null,
          onChanged: (v) => changedValue = v,
        ),
      ),
    );

    await tester.tap(find.byType(CheckboxListTile));
    expect(changedValue, true);
  });

  testWidgets('number field only reports parsed numeric values', (tester) async {
    dynamic changedValue;
    await tester.pumpWidget(
      _wrap(
        DynamicFormFieldWidget(
          field: _field(type: DynamicFieldType.number),
          value: null,
          errorText: null,
          onChanged: (v) => changedValue = v,
        ),
      ),
    );

    await tester.enterText(find.byType(TextFormField), '42');
    expect(changedValue, 42);
  });
}
