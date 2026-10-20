---
title: Java函数式接口
published: 2025-07-19
description: ''
image: ''
tags: [函数式接口, Java, 编程]
category: 'Java'
series: Java 基础
draft: false 
lang: ''
---

<https://www.cnblogs.com/dgwblog/p/11739500.html>

<https://juejin.cn/post/6844903892166148110>

![](https://blog.meowrain.cn/api/i/2025/05/31/x6m66n-0.webp)

![](https://blog.meowrain.cn/api/i/2025/05/31/x722c1-0.webp)

![](https://blog.meowrain.cn/api/i/2025/05/31/x74ils-0.webp)

## 1. `Supplier<T>` - 数据的供给者 🎁

**接口定义**：`@FunctionalInterface public interface Supplier<T> { T get(); }`

**核心作用**：
`Supplier` 接口的核心职责是**生产或提供数据**，它不接受任何参数，但会返回一个 `T` 类型的结果。你可以把它想象成一个“工厂”或者“源头”，当你需要一个特定类型的对象时，就调用它的 `get()` 方法。

**方法详解**：

* `T get()`: 这是 `Supplier` 接口中唯一的抽象方法。调用它时，会执行你提供的 Lambda 表达式或方法引用所定义的逻辑，并返回一个结果。

**常见应用场景**：

* **延迟加载/创建对象**：当某个对象的创建成本较高，或者并非立即需要时，可以使用 `Supplier` 来推迟其创建，直到真正使用时才调用 `get()`。
* **生成默认值或配置信息**：提供一个默认对象或从某个源（如配置文件、数据库）获取配置。
* **生成随机数据**：如示例中的随机数生成器。
* **作为工厂方法**：在更复杂的场景中，`Supplier` 可以作为创建对象的简单工厂。

**您的示例代码分析** (`SupplierExample.java`)：

```java
import java.util.Random;
import java.util.function.Supplier;

public class SupplierExample {

    // 示例方法1: 接收一个 Supplier 来获取随机整数
    public static Integer getRandomNumber(Supplier<Integer> randomNumberSupplier) {
        // 调用 randomNumberSupplier 的 get 方法来执行其提供的逻辑
        return randomNumberSupplier.get();
    }

    // 示例方法2: 接收一个 Supplier 来创建问候语字符串
    public static String createGreetingMessage(Supplier<String> greetingSupplier) {
        return greetingSupplier.get();
    }

    public static void main(String[] args) {
        // 场景1: 获取随机数
        // Lambda 表达式实现 Supplier: () -> new Random().nextInt(100)
        // 这个 Lambda 不接受参数，返回一个 0-99 的随机整数
        Supplier<Integer> randomIntSupplier = () -> new Random().nextInt(100);
        Integer num = getRandomNumber(randomIntSupplier); // 传递行为
        System.out.println("随机数: " + num);

        // 场景2: 获取固定数字
        // Lambda 表达式实现 Supplier: () -> 42
        // 这个 Lambda 总是返回固定的数字 42
        Supplier<Integer> fixedIntSupplier = () -> 42;
        Integer fixedNum = getRandomNumber(fixedIntSupplier);
        System.out.println("固定数字: " + fixedNum);

        // 场景3: 创建不同的问候语
        Supplier<String> englishGreeting = () -> "Hello, World!";
        System.out.println(createGreetingMessage(englishGreeting)); // 输出: Hello, World!

        Supplier<String> spanishGreeting = () -> "¡Hola, Mundo!";
        System.out.println(createGreetingMessage(spanishGreeting)); // 输出: ¡Hola, Mundo!
    }
}
```

**代码解读**：

* `getRandomNumber` 和 `createGreetingMessage` 方法本身并不关心数字或字符串是如何产生的，它们只依赖传入的 `Supplier` 来提供结果。这体现了**行为参数化**——方法接受行为（通过函数式接口）作为参数。
* 在 `main` 方法中：
  * `randomIntSupplier`: 定义了一个行为——“生成一个0到99的随机整数”。
  * `fixedIntSupplier`: 定义了另一个行为——“总是提供数字42”。
  * `englishGreeting` 和 `spanishGreeting`: 定义了不同的行为来提供特定的字符串。
* 通过将不同的 `Supplier` 实现传递给同一个方法 (`getRandomNumber` 或 `createGreetingMessage`)，我们可以获得不同的结果，而无需修改方法本身。

**关键益处**：

* **灵活性**：可以轻松替换不同的供给逻辑。
* **解耦**：数据的使用者和数据的生产者解耦。
* **可测试性**：可以方便地传入 mock 的 `Supplier` 进行单元测试。

---

## 2. `Function<T, R>` - 数据的转换器/映射器 🔄

**接口定义**：`@FunctionalInterface public interface Function<T, R> { R apply(T t); }`

**核心作用**：
`Function` 接口的核心职责是**将一个类型 `T` 的输入参数转换或映射成另一个类型 `R` 的输出结果**。它就像一个数据处理管道中的一个环节，接收数据，进行处理，然后传递给下一个环节。

**方法详解**：

* `R apply(T t)`: 这是 `Function` 的核心方法。它接受一个 `T` 类型的参数 `t`，对其执行Lambda表达式或方法引用中定义的转换逻辑，并返回一个 `R` 类型的结果。

**常见应用场景**：

* **数据转换**：例如，将字符串转换为整数，将日期对象格式化为字符串，或者如示例中计算字符串长度、数字平方。
* **对象属性提取**：从一个复杂对象中提取某个特定属性的值。例如，`Person -> String (person.getName())`。
* **链式操作**：`Function` 接口提供了 `andThen()` 和 `compose()` 默认方法，可以方便地将多个 `Function` 串联起来形成一个处理流水线。

**您的示例代码分析** (`FunctionExample.java`)：

```java
import java.util.function.Function;

public class FunctionExample {

    // 示例方法1: 接收一个 Function 来计算字符串长度
    public static Integer getStringLength(String text, Function<String, Integer> lengthCalculator) {
        // 调用 lengthCalculator 的 apply 方法，传入 text，执行其转换逻辑
        return lengthCalculator.apply(text);
    }

    // 示例方法2: 接收一个 Function 来计算数字的平方
    public static Integer squareNumber(Integer number, Function<Integer, Integer> squareFunction) {
        return squareFunction.apply(number);
    }

    public static void main(String[] args) {
        // 场景1: 计算字符串长度
        String myString = "Java Functional";
        // Lambda 表达式实现 Function: s -> s.length()
        // 这个 Lambda 接受一个 String s，返回其长度 (Integer)
        Function<String, Integer> lengthLambda = s -> s.length();
        Integer length = getStringLength(myString, lengthLambda);
        System.out.println("字符串 '" + myString + "' 的长度是: " + length);

        // 使用方法引用 (Method Reference) 实现 Function: String::length
        // String::length 等价于 s -> s.length()，更为简洁
        Integer lengthUsingMethodRef = getStringLength("Test", String::length);
        System.out.println("字符串 'Test' 的长度是: " + lengthUsingMethodRef);

        // 场景2: 计算数字平方
        Integer num = 5;
        // Lambda 表达式实现 Function: n -> n * n
        // 接受一个 Integer n，返回 n 的平方 (Integer)
        Function<Integer, Integer> squareLambda = n -> n * n;
        Integer squared = squareNumber(num, squareLambda);
        System.out.println(num + " 的平方是: " + squared);

        Integer anotherNum = 10;
        // 多行 Lambda 表达式
        Function<Integer, Integer> verboseSquareLambda = x -> {
            System.out.println("正在计算 " + x + " 的平方..."); // Lambda 可以包含多条语句
            return x * x;
        };
        Integer squaredAgain = squareNumber(anotherNum, verboseSquareLambda);
        System.out.println(anotherNum + " 的平方是: " + squaredAgain);
    }
}
```

**代码解读**：

* `getStringLength` 和 `squareNumber` 方法定义了操作的框架，但具体的转换逻辑由传入的 `Function` 对象决定。
* 在 `main` 方法中：
  * `s -> s.length()` 和 `String::length` 都是 `Function<String, Integer>` 的实例，它们定义了“从字符串到其长度整数”的转换。
  * `n -> n * n` 是 `Function<Integer, Integer>` 的实例，定义了“从整数到其平方整数”的转换。
  * 多行 Lambda `verboseSquareLambda` 展示了更复杂的转换逻辑可以被封装。
* 这种方式使得我们可以为同一个通用方法（如 `getStringLength`）提供不同的转换策略。

**关键益处**：

* **代码复用**：通用的转换逻辑可以被封装成 `Function` 并在多处使用。
* **可组合性**：通过 `andThen` 和 `compose` 可以构建复杂的转换流。
* **清晰性**：将数据转换的意图明确表达出来。

---

## 3. `BiConsumer<T, U>` - 双参数的消费者/执行者 🤝

**接口定义**：`@FunctionalInterface public interface BiConsumer<T, U> { void accept(T t, U u); }`

**核心作用**：
`BiConsumer` 接口的核心职责是**对两个不同类型（或相同类型）的输入参数 `T` 和 `U` 执行某个操作或产生某种副作用，但它不返回任何结果 (void)**。你可以把它看作是需要两个输入才能完成其工作的“执行者”。

**方法详解**：

* `void accept(T t, U u)`: 这是 `BiConsumer` 的核心方法。它接受两个参数 `t` 和 `u`，并对它们执行 Lambda 表达式或方法引用中定义的操作。由于返回类型是 `void`，它通常用于执行有副作用的操作，如打印、修改集合、更新数据库等。

**常见应用场景**：

* **处理键值对**：非常适合用于迭代 `Map` 的条目，如 `Map.forEach()` 方法就接受一个 `BiConsumer<K, V>`。
* **同时操作两个相关对象**：当一个操作需要两个输入，并且不产生新的独立结果时。例如，将一个对象的属性设置到另一个对象上。
* **配置或初始化**：使用两个参数来配置某个组件。

**您的示例代码分析** (`BiConsumerExample.java`)：

```java
import java.util.HashMap;
import java.util.Map;
import java.util.function.BiConsumer;

public class BiConsumerExample {

    // 示例方法1: 接收 BiConsumer 来打印键和值
    public static <K, V> void printMapEntry(K key, V value, BiConsumer<K, V> entryPrinter) {
        // 调用 entryPrinter 的 accept 方法，传入 key 和 value
        entryPrinter.accept(key, value);
    }

    // 示例2 在 main 中直接演示了更常见的 Map 操作方式

    // 辅助内部类，如果 BiConsumer 需要一次性接收多个信息 (在此示例中未直接用于核心 BiConsumer 演示)
    // static class Pair<F, S> {
    //     F first; S second;
    //     Pair(F f, S s) { this.first = f; this.second = s; }
    // }

    public static void main(String[] args) {
        // 场景1: 使用 printMapEntry 打印键值
        // Lambda 表达式实现 BiConsumer: (k, v) -> System.out.println("键: " + k + ", 值: " + v)
        // 接受一个 String k 和一个 Integer v，然后打印它们
        BiConsumer<String, Integer> simplePrinter = (k, v) -> System.out.println("键: " + k + ", 值: " + v);
        printMapEntry("年龄", 30, simplePrinter);
        printMapEntry("数量", 100, simplePrinter);

        // 场景2: 使用 BiConsumer 来填充 Map
        Map<String, String> config = new HashMap<>();
        // Lambda 表达式实现 BiConsumer: (key, value) -> config.put(key, value)
        // 这个 Lambda 捕获了外部的 'config' Map 对象。
        // 它接受 String key 和 String value，并将它们放入 config Map 中。
        BiConsumer<String, String> mapPutter = (key, value) -> config.put(key, value);

        mapPutter.accept("user.name", "Alice"); // 执行操作：config.put("user.name", "Alice")
        mapPutter.accept("user.role", "Admin");   // 执行操作：config.put("user.role", "Admin")
        System.out.println("配置Map: " + config);

        // 场景3: Map.forEach() 的典型用法
        // Map 的 forEach 方法直接接受一个 BiConsumer<K, V>
        System.out.println("遍历Map:");
        config.forEach((key, value) -> { // 这里的 (key, value) -> {...} 就是一个 BiConsumer
            System.out.println("配置项 - " + key + ": " + value);
        });
    }
}
```

**代码解读**：

* `printMapEntry` 方法接受一个键、一个值和一个 `BiConsumer`，该 `BiConsumer` 定义了如何处理这对键值。
* 在 `main` 方法中：
  * `simplePrinter`: 定义了一个行为——“接收一个键和一个值，并将它们打印到控制台”。
  * `mapPutter`: 定义了一个行为——“接收一个键和一个字符串值，并将它们存入外部的 `config` Map”。这里 Lambda 表达式捕获了外部变量 `config`，这是一种常见的用法。
  * `config.forEach(...)`: 这是 `BiConsumer` 最经典的用例之一。`forEach` 方法遍历 `Map` 中的每个条目，并对每个键值对执行提供的 `BiConsumer` 逻辑。

**关键益处**：

* **处理成对数据**：专门设计用于需要两个输入的场景。
* **与集合（尤其是Map）的良好集成**：`Map.forEach` 是一个很好的例子。
* **封装副作用操作**：可以将对两个参数的副作用操作（如修改、打印）封装起来。

---

## 4. `Consumer<T>` - 数据的消费者/执行者 🍽️

**接口定义**：`@FunctionalInterface public interface Consumer<T> { void accept(T t); }`

**核心作用**：
`Consumer` 接口的核心职责是**对单个输入参数 `T` 执行某个操作或产生某种副作用，它不返回任何结果 (void)**。你可以把它看作是数据的“终点”或某个动作的执行者，它“消费”数据但不产生新的输出数据。

**方法详解**：

* `void accept(T t)`: 这是 `Consumer` 的核心方法。它接受一个 `T` 类型的参数 `t`，并对其执行 Lambda 表达式或方法引用中定义的操作。因为返回 `void`，它主要用于执行那些为了副作用而进行的操作（如打印、修改对象状态、写入文件等）。

**常见应用场景**：

* **迭代集合并处理元素**：`List.forEach()` 方法接受一个 `Consumer<T>`，对列表中的每个元素执行指定操作。
* **打印/日志记录**：将信息输出到控制台、文件或其他日志系统。
* **更新对象状态**：修改传入对象的属性。
* **回调**：在某个异步操作完成后执行一个 `Consumer` 定义的动作。

**您的示例代码分析** (`ConsumerExample.java`)：

```java
import java.util.Arrays;
import java.util.List;
import java.util.function.Consumer;

public class ConsumerExample {

    // 示例方法1: 接收 Consumer 来展示单个项目
    public static <T> void displayItem(T item, Consumer<T> itemDisplayer) {
        // 调用 itemDisplayer 的 accept 方法，传入 item，执行其消费逻辑
        itemDisplayer.accept(item);
    }

    // 示例方法2: 接收 Consumer 来处理列表中的每个项目
    public static <T> void processListItems(List<T> list, Consumer<T> itemProcessor) {
        for (T item : list) {
            itemProcessor.accept(item); // 对列表中的每个 item 执行 itemProcessor 的逻辑
        }
    }

    public static void main(String[] args) {
        // 场景1: 使用 displayItem 打印信息
        // Lambda 表达式实现 Consumer: message -> System.out.println("消息: " + message)
        // 接受一个 String message，然后打印它
        Consumer<String> consolePrinter = message -> System.out.println("消息: " + message);
        displayItem("你好，函数式接口!", consolePrinter);

        // 多行 Lambda 实现 Consumer，进行更复杂的打印
        Consumer<Integer> detailedPrinter = number -> {
            System.out.println("--- 数字详情 ---");
            System.out.println("值: " + number);
            System.out.println("是否偶数: " + (number % 2 == 0));
            System.out.println("----------------");
        };
        displayItem(10, detailedPrinter);
        displayItem(7, System.out::println); // 方法引用: System.out::println 等价于 x -> System.out.println(x)

        // 场景2: 使用 processListItems 处理列表
        List<String> names = Arrays.asList("爱丽丝", "鲍勃", "查理");

        System.out.println("\n打印名字:");
        // Lambda: name -> System.out.println("你好, " + name + "!")
        // 对列表中的每个名字，执行打印问候语的操作
        processListItems(names, name -> System.out.println("你好, " + name + "!"));

        System.out.println("\n将名字转换为大写并打印 (仅打印，不修改原列表):");
        // Lambda: name -> System.out.println(name.toUpperCase())
        // 对列表中的每个名字，先转大写，然后打印
        processListItems(names, name -> System.out.println(name.toUpperCase()));

        // Consumer 也可以有副作用，比如修改外部状态 (通常需谨慎使用以避免复杂性)
        StringBuilder allNames = new StringBuilder();
        // Lambda: name -> allNames.append(name).append(" ")
        // 这个 Consumer 修改了外部的 allNames 对象
        processListItems(names, name -> allNames.append(name).append(" "));
        System.out.println("\n拼接所有名字: " + allNames.toString().trim());

        // List.forEach 的典型用法
        System.out.println("\n使用 List.forEach 打印名字（大写）:");
        names.forEach(name -> System.out.println(name.toUpperCase())); // name -> System.out.println(...) 是一个Consumer
    }
}
```

**代码解读**：

* `displayItem` 方法接受一个项目和一个 `Consumer`，该 `Consumer` 定义了如何“消费”或处理这个项目。
* `processListItems` 方法遍历列表，并对每个元素应用传入的 `Consumer` 逻辑。这与 `List.forEach()` 的行为非常相似。
* 在 `main` 方法中：
  * `consolePrinter` 和 `detailedPrinter` 定义了不同的打印行为。`System.out::println` 是一个简洁的方法引用，用于直接打印。
  * 在处理 `names` 列表时，通过传递不同的 `Consumer` 给 `processListItems`，实现了不同的处理逻辑（简单问候、转换为大写打印、追加到 `StringBuilder`）。
  * `allNames.append(...)` 的例子展示了 `Consumer` 如何产生副作用（修改外部对象的状态）。虽然强大，但在复杂系统中应谨慎使用副作用，以保持代码的可预测性。
  * `names.forEach(...)` 直接使用了 `List` 接口内置的 `forEach` 方法，该方法就接受一个 `Consumer`。

**关键益处**：

* **执行动作**：非常适合表示对数据执行的无返回值的操作。
* **迭代与处理**：与集合框架（如 `List.forEach`）完美配合，简化迭代代码。
* **封装副作用**：将有副作用的操作（如I/O、UI更新）封装到 `Consumer` 中，使得代码意图更清晰。

---
